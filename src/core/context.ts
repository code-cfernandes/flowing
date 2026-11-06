import type { IncomingMessage, OutgoingHttpHeader, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from './errors.ts';
import { parseQuery, type ParsedQuery } from '../utils/query.ts';
import { parseCookies, serializeCookie, type CookieOptions } from '../utils/cookie.ts';
import { hostnameOf, isValidHost, parseRequestTarget, pickForwarded } from '../utils/request-target.ts';
import { silentLogger, type Logger } from './logger.ts';
import type { InferBody, InferParams, InferQuery, InferResponse, ParamsOf } from './infer.ts';
import type { RouteSchemas } from './metadata.ts';
import { sendResult, type SendMode, type Serializer } from './response.ts';
import { sendFile, type SendFileOptions } from '../server/static.ts';

/** @internal Envio cru, sem pipeline: usado pelo próprio pipeline, por erros e por 404/405. */
export const kRawSend = Symbol('sashiko.rawSend');
/** @internal Cancela o `ctx.signal` (encerramento do app) (F-13). */
export const kAbort = Symbol('sashiko.abort');
/** @internal Liga o contexto aos schemas de resposta da rota, antes do handler (F-32). */
export const kBindResponse = Symbol('sashiko.bindResponse');

type RawBody = string | Uint8Array | Readable;

/** Um evento de Server-Sent Events (F-13). `data` em objeto vira JSON; strings com várias linhas são divididas. */
export interface SseEvent {
  data: unknown;
  event?: string;
  id?: string;
  /** Sugestão de espera para o navegador reconectar, em ms. */
  retry?: number;
}

/** Conexão SSE aberta por `ctx.sse()`. */
export interface SseStream {
  send(event: SseEvent | string): void;
  /** Comentário (`: texto`), ignorado pelo navegador; útil como keep-alive. */
  comment(text: string): void;
  /** Encerra a resposta. */
  close(): void;
  /** Chamado quando a conexão termina: o cliente desconectou, `close()` ou encerramento do app. */
  onClose(listener: () => void): void;
  readonly closed: boolean;
  /** `Last-Event-ID` enviado pelo navegador ao reconectar. */
  readonly lastEventId: string | undefined;
}

export interface SseOptions {
  /** Comentário periódico para proxies não derrubarem a conexão ociosa. Padrão: 15000 ms; `0` desliga. */
  heartbeatMs?: number;
  /** `retry:` enviado na abertura. */
  retry?: number;
}

/**
 * Campos de uma linha SSE não podem ter quebra de linha (seria injeção de evento); `id` também não pode
 * ter U+0000, que faz o navegador ignorar o campo.
 */
const sseField = (name: string, value: string) => {
  if (/[\r\n]/.test(value)) throw new Error(`[sashiko] ctx.sse(): "${name}" cannot contain line breaks.`);
  if (name === 'id' && value.includes('\0')) throw new Error('[sashiko] ctx.sse(): "id" cannot contain U+0000.');
  return `${name}: ${value}\n`;
};

/** `retry` e `heartbeatMs`: inteiro não negativo, como o protocolo exige. */
const nonNegativeInt = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`[sashiko] ctx.sse(): "${name}" must be a non-negative integer (got ${value}).`);
  }
  return value;
};

/** Corpo e tipo de uma resposta prestes a ser escrita (F-04). */
export interface SendPayload {
  body: string | Uint8Array;
  contentType: string;
}

/**
 * Roda imediatamente antes de escrever uma resposta com corpo (exceto streams), inclusive em
 * erros e 404. É síncrono; pode alterar headers e devolver outro payload (F-04).
 */
// biome-ignore lint/suspicious/noConfusingVoidType: hooks sem `return` precisam ser aceitos (inferem `void`).
export type OnSendHook = (ctx: Context, payload: SendPayload) => SendPayload | void;

/** Status aceitos por `ctx.status()`: os declarados no schema de resposta, ou qualquer um sem schema (F-32). */
export type DeclaredStatus<S extends RouteSchemas> = S['response'] extends Record<number, unknown> ? keyof S['response'] & number : number;

/** Corpo esperado para o status `St`: o do schema, ou qualquer valor sem schema (F-32). */
export type BodyFor<S extends RouteSchemas, St extends number> =
  S['response'] extends Record<number, unknown> ? InferResponse<S, St> : unknown;

/**
 * Contexto depois de `ctx.status(St)`: `json()` e `send()` exigem o corpo do status escolhido (F-32).
 *
 * ```ts
 * return ctx.status(202).json({ jobId });   // o TypeScript confere o corpo contra o schema do 202
 * ```
 */
export type StatusContext<S extends RouteSchemas | string, St extends number> = Omit<Context<S>, 'json' | 'send'> & {
  json(body: BodyFor<SchemasOf<S>, St>): Context<S>;
  send(body: BodyFor<SchemasOf<S>, St> | RawBody, contentType?: string): Context<S>;
};

/** Um path no lugar dos schemas (`Context<'/:id'>`) equivale a uma rota sem schemas (F-29). */
export type SchemasOf<S extends RouteSchemas | string> = S extends string ? {} : S;
/** `ctx.params`: pelo path (`Context<'/:id'>`) ou pelo schema `params`. */
export type ParamsFor<S extends RouteSchemas | string> = S extends string ? ParamsOf<S> : InferParams<SchemasOf<S>>;

/**
 * Estado por requisição, compartilhado entre middlewares, guards e handlers.
 * Estenda com declaration merging para ter tipos (F-01):
 *
 * ```ts
 * declare module 'sashiko' {
 *   interface ContextState { user?: { id: string; role: 'admin' | 'user' } }
 * }
 * ```
 */
export interface ContextState {
  [key: string]: unknown;
}

export interface ContextOptions {
  queryMaxKeys?: number | undefined;
  /** Id da requisição; o app gera ou reaproveita o header recebido (F-06). */
  id?: string | undefined;
  /** Logger do app; o contexto cria um filho com o `reqId`. */
  logger?: Logger | undefined;
  /** Confiança nos headers `X-Forwarded-*` (S-09). Padrão: `false`. */
  trustProxy?: boolean | number | undefined;
  /** Hooks `onSend` do app (F-04). */
  onSend?: readonly OnSendHook[] | undefined;
}

/**
 * Contexto da requisição. Passe os schemas da rota no genérico para tipar
 * `params`, `query` e `body` a partir do `@Schema` (F-02):
 *
 * ```ts
 * const create = { body: CreateUserSchema, response: { 201: UserSchema } } satisfies RouteSchemas;
 * @Post('/') @Schema(create) createUser(ctx: Context<typeof create>) { ctx.body.name }
 * @Get('/:id') get(ctx: Context<'/:id'>) { ctx.params.id }
 * ```
 */
export class Context<S extends RouteSchemas | string = RouteSchemas> {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly path: string;
  readonly url: URL;
  /** Id da requisição, também enviado no header `X-Request-Id` (F-06). */
  readonly id: string;
  /** Logger da requisição, já com `reqId` (F-06). */
  readonly log: Logger;

  /** Parâmetros de rota; tipados pelo schema `params` quando informado em `Context<S>`. */
  params: ParamsFor<S> = {} as ParamsFor<S>;
  /** Query string; tipada pelo schema `query` (já com coerção e defaults aplicados). */
  query: InferQuery<SchemasOf<S>>;
  /** Body; tipado pelo schema `body`. */
  body: InferBody<SchemasOf<S>> = undefined as InferBody<SchemasOf<S>>;
  state: ContextState = {};

  /** `true` quando o handler chamou `ctx.status()`. Usado para escolher o schema de resposta (B-05). */
  statusExplicit = false;

  private streaming = false;
  private abortController: AbortController | undefined;

  /**
   * Cancelado quando o cliente desconecta antes do fim da resposta, ou quando o app está encerrando
   * (F-13). Passe para consultas e `fetch` longos: `db.query(sql, { signal: ctx.signal })`.
   */
  get signal(): AbortSignal {
    if (!this.abortController) {
      const controller = new AbortController();
      this.abortController = controller;
      if (this.res.writableFinished) return controller.signal;
      // O cliente pode ter desconectado antes do primeiro acesso ao signal (num `await` anterior):
      // o evento 'close' já passou, então o estado precisa ser conferido agora.
      if (this.res.destroyed || this.req.destroyed || this.req.socket?.destroyed) {
        controller.abort(new Error('client disconnected'));
        return controller.signal;
      }
      this.res.once('close', () => {
        if (!this.res.writableFinished) controller.abort(new Error('client disconnected'));
      });
    }
    return this.abortController.signal;
  }

  /** @internal `true` em respostas de streaming (SSE, NDJSON, `Readable`) já iniciadas. */
  get streamingResponse(): boolean {
    return this.streaming;
  }

  /** @internal */
  [kAbort](reason: string): void {
    void this.signal;
    this.abortController?.abort(new Error(reason));
  }

  /**
   * Abre uma conexão de Server-Sent Events (F-13). A resposta fica aberta até `close()`, a desconexão do
   * cliente ou o encerramento do app, que fecha estas conexões primeiro para o shutdown não esperar por elas.
   *
   * ```ts
   * const stream = ctx.sse();
   * const off = bus.on('order', (o) => stream.send({ event: 'order', id: o.id, data: o }));
   * stream.onClose(off);
   * ```
   */
  sse(opts: SseOptions = {}): SseStream {
    if (this.sent) throw new Error('[sashiko] ctx.sse(): the response was already sent.');
    // Valida antes de abrir a resposta: um erro aqui ainda vira um 500 normal.
    const heartbeatMs = nonNegativeInt('heartbeatMs', opts.heartbeatMs ?? 15_000);
    if (opts.retry !== undefined) nonNegativeInt('retry', opts.retry);
    const res = this.res;
    this.streaming = true;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.removeHeader('Content-Length');
    res.flushHeaders();

    const listeners: (() => void)[] = [];
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      for (const l of listeners.splice(0)) {
        try {
          l();
        } catch (err) {
          this.log.error({ err }, 'sse onClose listener failed');
        }
      }
    };
    const write = (chunk: string) => {
      if (!closed && !res.writableEnded) res.write(chunk);
    };
    const heartbeat = setInterval(() => write(': ping\n\n'), heartbeatMs || 2 ** 31 - 1);
    heartbeat.unref();
    if (!heartbeatMs) clearInterval(heartbeat);
    res.once('close', finish);
    this.signal.addEventListener('abort', () => stream.close(), { once: true });
    if (opts.retry !== undefined) write(`retry: ${opts.retry}\n\n`);

    const stream: SseStream = {
      send: (event) => {
        const e: SseEvent = typeof event === 'string' ? { data: event } : event;
        let out = '';
        if (e.event !== undefined) out += sseField('event', e.event);
        if (e.id !== undefined) out += sseField('id', e.id);
        if (e.retry !== undefined) out += `retry: ${nonNegativeInt('retry', e.retry)}\n`;
        if (e.data === undefined) throw new Error('[sashiko] ctx.sse(): "data" is required; use "" for an empty event.');
        const text = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
        for (const line of text.split(/\r\n|\r|\n/)) out += `data: ${line}\n`;
        write(`${out}\n`);
      },
      comment: (text) => write(`: ${text.replace(/[\r\n]+/g, ' ')}\n\n`),
      close: () => {
        if (!res.writableEnded) res.end();
        finish();
      },
      onClose: (listener) => {
        if (closed) listener();
        else listeners.push(listener);
      },
      get closed() {
        return closed;
      },
      lastEventId: this.get('last-event-id'),
    };
    return stream;
  }

  /**
   * Envia um arquivo com `Content-Type`, `ETag`/`Last-Modified` (304) e `Range` (206), em stream (F-13).
   * Com `root`, o path é relativo e não pode sair dela; sem `root`, precisa ser absoluto.
   * Arquivo inexistente responde 404.
   */
  async sendFile(path: string, opts?: SendFileOptions): Promise<void> {
    await sendFile(this as unknown as Context, path, opts);
  }
  private readonly onSendHooks: readonly OnSendHook[];

  /**
   * Corpo exatamente como foi escrito (F-04), depois do envio. Fica `undefined` em streams e em
   * respostas sem corpo. Útil para cache: `await next(); store.set(key, ctx.sentBody)`.
   */
  sentBody: Buffer | undefined;
  /** `Content-Type` da resposta enviada, junto com `sentBody`. */
  sentType: string | undefined;
  private bound: { response: RouteSchemas['response']; serializers: ReadonlyMap<string, Serializer> } | undefined;

  constructor(req: IncomingMessage, res: ServerResponse, opts: ContextOptions = {}) {
    this.req = req;
    this.res = res;
    this.method = req.method ?? 'GET';
    this.trustProxy = opts.trustProxy ?? false;
    this.onSendHooks = opts.onSend ?? [];
    // S-09: o path vem do request-target com base fixa; o host do cliente nunca entra no parsing.
    const target = parseRequestTarget(req.url);
    this.path = target.pathname;
    this.query = parseQuery(target.searchParams, opts.queryMaxKeys) as ParsedQuery as InferQuery<SchemasOf<S>>;
    this.url = new URL(`${this.protocol}://${this.host || 'localhost'}${target.pathname}${target.search}`);
    this.id = opts.id ?? '';
    this.log = (opts.logger ?? silentLogger).child({ reqId: this.id });
  }

  private readonly trustProxy: boolean | number;

  /**
   * IP do cliente. Por padrão, o do socket. Com `trustProxy`, vem do `X-Forwarded-For`, que só deve
   * ser ligado atrás de um proxy que reescreve esse header (S-09).
   */
  get ip(): string {
    return pickForwarded(this.req.headers['x-forwarded-for'], this.trustProxy) ?? this.req.socket.remoteAddress ?? '';
  }

  /**
   * Host da requisição (`api.exemplo.com:8080`), **validado**: um valor inválido vira `''`.
   * Com `trustProxy`, vem do `X-Forwarded-Host`. Para links absolutos, prefira uma URL base
   * configurada em vez do host pedido pelo cliente (S-09).
   */
  get host(): string {
    const forwarded = pickForwarded(this.req.headers['x-forwarded-host'], this.trustProxy);
    if (forwarded !== undefined) return isValidHost(forwarded) ? forwarded : '';
    const host = this.req.headers.host;
    return isValidHost(host) ? host : '';
  }

  /** `host` sem a porta. */
  get hostname(): string {
    return this.host ? hostnameOf(this.host) : '';
  }

  /** `https` se a conexão for TLS ou, com `trustProxy`, se o `X-Forwarded-Proto` disser; senão `http`. */
  get protocol(): 'http' | 'https' {
    const forwarded = pickForwarded(this.req.headers['x-forwarded-proto'], this.trustProxy)?.toLowerCase();
    if (forwarded === 'https' || forwarded === 'http') return forwarded;
    return (this.req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http';
  }

  /**
   * Define o status. Com schemas de resposta, aceita só os status declarados e o encadeamento tipa o
   * corpo: `ctx.status(202).json({ jobId })` (F-32).
   */
  status<const St extends DeclaredStatus<SchemasOf<S>>>(code: St): StatusContext<S, St> {
    this.res.statusCode = code;
    this.statusExplicit = true;
    return this as unknown as StatusContext<S, St>;
  }

  /**
   * `true` quando a resposta já foi enviada (ou está sendo, no caso de streams).
   * Depois disso o framework não escreve mais nada na resposta.
   */
  get sent(): boolean {
    return this.streaming || this.res.writableEnded;
  }

  /** Lê um header da requisição (case-insensitive). Headers repetidos são unidos com `, `. */
  get(name: string): string | undefined {
    const value = this.req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value.join(', ') : value;
  }

  private parsedCookies: Record<string, string> | undefined;

  /** Cookies da requisição (objeto sem protótipo; em nomes repetidos vale o primeiro). */
  get cookies(): Readonly<Record<string, string>> {
    return (this.parsedCookies ??= parseCookies(this.get('cookie')));
  }

  /**
   * Adiciona um `Set-Cookie`. Padrões: `HttpOnly`, `Secure`, `SameSite=Lax` e `Path=/`.
   * Se usar cookies para autenticar, ative também o middleware `csrf()`.
   */
  setCookie(name: string, value: string, opts?: CookieOptions): this {
    this.res.appendHeader('Set-Cookie', serializeCookie(name, value, opts));
    return this;
  }

  /** Remove um cookie. Informe o mesmo `path` e `domain` usados ao criá-lo. */
  clearCookie(name: string, opts: Omit<CookieOptions, 'maxAge' | 'expires'> = {}): this {
    return this.setCookie(name, '', { ...opts, maxAge: 0, expires: new Date(0) });
  }

  /** Define um header da resposta. */
  header(name: string, value: OutgoingHttpHeader): this {
    this.res.setHeader(name, value);
    return this;
  }

  /**
   * Envia JSON. No handler, passa pelo mesmo pipeline do `return`: schema do status, remoção de
   * campos não declarados e status padrão (F-32).
   */
  json(data: unknown): this {
    return this.dispatch(data, 'json');
  }

  /** Resposta em texto puro (`text/plain; charset=utf-8`), pelo mesmo pipeline do `return`. */
  text(data: string): this {
    return this.dispatch(data, 'text');
  }

  /**
   * Envia o corpo pelo mesmo pipeline do `return` (F-32): com `contentType` informado, usa esse tipo;
   * senão, a negociação do `Accept` ou o tipo do valor (string, Buffer, stream, objeto → JSON).
   * Para HTML, faça o escape do conteúdo dinâmico antes: o framework não faz isso por você (S-02).
   */
  send(body: unknown, contentType?: string): this {
    if (this.sent) return this;
    if (contentType) this.res.setHeader('Content-Type', contentType);
    return this.dispatch(body, 'auto');
  }

  private dispatch(body: unknown, mode: SendMode): this {
    if (this.sent) return this;
    // Antes do handler (middlewares, guards) não há schema ligado: vale só o tipo do conteúdo.
    sendResult(this as unknown as Context, this.bound?.response, body, this.bound?.serializers, mode);
    return this;
  }

  /** @internal Liga os schemas de resposta da rota (o app chama antes do handler). */
  [kBindResponse](response: RouteSchemas['response'], serializers: ReadonlyMap<string, Serializer>): void {
    this.bound = { response, serializers };
  }

  /** @internal Envio cru, sem schema: string, bytes ou stream. */
  [kRawSend](body: RawBody, contentType?: string): this {
    if (this.sent) return this;
    if (contentType) this.res.setHeader('Content-Type', contentType);
    else if (!this.res.hasHeader('Content-Type')) this.res.setHeader('Content-Type', 'application/octet-stream');

    if (body instanceof Readable) {
      this.streaming = true;
      pipeline(body, this.res).catch((err: unknown) => {
        this.log.error({ err, method: this.method, path: this.path }, 'stream failed');
        this.res.destroy(err as Error);
      });
      return this;
    }
    const payload = this.runOnSend({ body, contentType: String(this.res.getHeader('Content-Type')) });
    this.res.setHeader('Content-Type', payload.contentType);
    this.sentBody = Buffer.from(payload.body);
    this.sentType = payload.contentType;
    this.res.end(this.sentBody);
    return this;
  }

  /** Aplica os `onSend`; se algum lançar, loga e envia o payload original (F-04). */
  private runOnSend(original: SendPayload): SendPayload {
    let payload = original;
    try {
      for (const hook of this.onSendHooks) payload = hook(this as unknown as Context, payload) ?? payload;
      return payload;
    } catch (err) {
      this.log.error({ err, method: this.method, path: this.path }, 'onSend hook failed; sending original response');
      return original;
    }
  }

  /**
   * Redireciona (padrão 302). Não use `url` vinda do usuário sem validar: isso abre um
   * open redirect. Prefira caminhos relativos ou uma lista de destinos permitidos.
   */
  redirect(url: string, status: 301 | 302 | 303 | 307 | 308 = 302): this {
    if (this.sent) return this;
    this.res.statusCode = status;
    this.statusExplicit = true;
    this.res.setHeader('Location', url);
    this.res.end();
    return this;
  }

  throw(status: number, message: string, code?: string): never {
    throw new HttpError(status, message, code);
  }
}

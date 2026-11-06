import type { IncomingMessage, OutgoingHttpHeader, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from './errors.ts';
import { parseQuery, type ParsedQuery } from '../utils/query.ts';
import { parseCookies, serializeCookie, type CookieOptions } from '../utils/cookie.ts';
import { hostnameOf, isValidHost, parseRequestTarget, pickForwarded } from '../utils/request-target.ts';
import { silentLogger, type Logger } from './logger.ts';
import type { InferBody, InferParams, InferQuery, InferResponse } from './infer.ts';
import type { RouteSchemas } from './metadata.ts';
import { sendResult, type SendMode, type Serializer } from './response.ts';

/** @internal Envio cru, sem pipeline: usado pelo próprio pipeline, por erros e por 404/405. */
export const kRawSend = Symbol('sashiko.rawSend');
/** @internal Liga o contexto aos schemas de resposta da rota, antes do handler (F-32). */
export const kBindResponse = Symbol('sashiko.bindResponse');

type RawBody = string | Uint8Array | Readable;

/** Corpo e tipo de uma resposta prestes a ser escrita (F-04). */
export interface SendPayload {
  body: string | Uint8Array;
  contentType: string;
}

/**
 * Roda imediatamente antes de escrever uma resposta com corpo (exceto streams), inclusive em
 * erros e 404. É síncrono; pode alterar headers e devolver outro payload (F-04).
 */
export type OnSendHook = (ctx: Context, payload: SendPayload) => SendPayload | void;

/** Status aceitos por `ctx.status()`: os declarados no schema de resposta, ou qualquer um sem schema (F-32). */
export type DeclaredStatus<S extends RouteSchemas> =
  S['response'] extends Record<number, unknown> ? keyof S['response'] & number : number;

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
export type StatusContext<S extends RouteSchemas, St extends number> = Omit<Context<S>, 'json' | 'send'> & {
  json(body: BodyFor<S, St>): Context<S>;
  send(body: BodyFor<S, St> | RawBody, contentType?: string): Context<S>;
};

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
 * ```
 */
export class Context<S extends RouteSchemas = RouteSchemas> {
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
  params: InferParams<S> = {} as InferParams<S>;
  /** Query string; tipada pelo schema `query` (já com coerção e defaults aplicados). */
  query: InferQuery<S>;
  /** Body; tipado pelo schema `body`. */
  body: InferBody<S> = undefined as InferBody<S>;
  state: ContextState = {};

  /** `true` quando o handler chamou `ctx.status()`. Usado para escolher o schema de resposta (B-05). */
  statusExplicit = false;

  private streaming = false;
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
    this.query = parseQuery(target.searchParams, opts.queryMaxKeys) as ParsedQuery as InferQuery<S>;
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
  status<const St extends DeclaredStatus<S>>(code: St): StatusContext<S, St> {
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
    sendResult(this, this.bound?.response, body, this.bound?.serializers, mode);
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
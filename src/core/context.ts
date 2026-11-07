import type { IncomingMessage, OutgoingHttpHeader, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from './errors.ts';
import { parseQuery, type ParsedQuery } from '../utils/query.ts';
import { parseCookies, serializeCookie, type CookieOptions } from '../utils/cookie.ts';
import { hostnameOf, isValidHost, pickForwarded, type RequestTarget, splitRequestTarget } from '../utils/request-target.ts';
import { silentLogger, type Logger } from './logger.ts';
import type { InferBody, InferParams, InferQuery, InferResponse, ParamsOf } from './infer.ts';
import type { RouteSchemas } from './metadata.ts';
import { sendResult, type ResponsePlan, type SendMode } from './response/pipeline.ts';
import { type AbortCode, type ErrorPhase, RequestAbortedError } from './abort.ts';
import type { RouteInfo } from './route-table.ts';
import { parseTraceparent, type TraceContext } from '../utils/trace-context.ts';
import { telemetryIds } from './telemetry.ts';
import { kAbort, kBindResponse, kError, kPendingSend, kPhase, kRawSend, kRoute, kRouted, kTelemetry } from './symbols.ts';
import { sendFile, type SendFileOptions } from '../server/static.ts';
import { openSse, type SseOptions, type SseStream } from './streaming/sse.ts';

export type { SseEvent, SseOptions, SseStream } from './streaming/sse.ts';

export { kAbort, kBindResponse, kPendingSend, kRawSend } from './symbols.ts';

type RawBody = string | Uint8Array | Readable;

/** Erros de stream que só significam que o cliente foi embora (P-12). */
const CLIENT_GONE = new Set(['ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_UNABLE_TO_PIPE', 'ERR_STREAM_DESTROYED']);
function isClientDisconnect(err: unknown): boolean {
  return typeof err === 'object' && err !== null && CLIENT_GONE.has((err as { code?: string }).code ?? '');
}

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
  /** Avisado quando a resposta vira stream, para o `close()` do app cancelar streams abertos. */
  onStream?: ((ctx: Context) => void) | undefined;
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
  /** Id da requisição, também enviado no header `X-Request-Id` (F-06). */
  readonly id: string;

  /** Parâmetros de rota; tipados pelo schema `params` quando informado em `Context<S>`. */
  get params(): ParamsFor<S> {
    this.routeParams ??= {} as ParamsFor<S>;
    return this.routeParams;
  }
  set params(value: ParamsFor<S>) {
    this.routeParams = value;
  }
  private routeParams: ParamsFor<S> | undefined;
  /**
   * A rota que atende esta requisição (F-38): template com o prefixo, classe, método e a regra de host que
   * venceu. `undefined` antes do roteamento e quando nenhuma rota atende (404, 405, healthcheck, OpenAPI).
   * Use `ctx.route.path` como rótulo de métrica, nunca `ctx.path`.
   */
  get route(): RouteInfo | undefined {
    return this[kRoute];
  }
  /** @internal */
  [kRoute]: RouteInfo | undefined;
  /** @internal Etapa atual do pipeline, para a fase do `onError` (F-38). */
  [kPhase]: ErrorPhase = 'middleware';
  /** @internal A cadeia global chegou ao roteamento (o último middleware chamou `next()`). */
  [kRouted] = false;
  /** @internal O erro tratado pelo pipeline de erros, para o `onResponse` (F-38). */
  [kError]: unknown;
  /** @internal Estado do `telemetry` desta requisição; só o módulo do telemetry lê e escreve (F-38). */
  [kTelemetry]: unknown;
  /** Query string; tipada pelo schema `query` (já com coerção e defaults aplicados). Lida no primeiro acesso. */
  get query(): InferQuery<SchemasOf<S>> {
    this.parsedQuery ??= parseQuery(new URLSearchParams(this.target.search), this.opts.queryMaxKeys) as ParsedQuery;
    return this.parsedQuery as InferQuery<SchemasOf<S>>;
  }
  set query(value: InferQuery<SchemasOf<S>>) {
    this.parsedQuery = value as ParsedQuery;
  }

  /** URL completa da requisição, com o host validado (S-09). Criada no primeiro acesso. */
  get url(): URL {
    this.fullUrl ??= new URL(`${this.protocol}://${this.host || 'localhost'}${this.target.pathname}${this.target.search}`);
    return this.fullUrl;
  }

  /** Logger da requisição, já com `reqId` (F-06). Criado no primeiro acesso. */
  get log(): Logger {
    if (!this.requestLog) {
      // Com `telemetry`, os ids do span desta requisição; sem, o `traceId` recebido no `traceparent`.
      const ids = telemetryIds(this as unknown as Context);
      const traceId = ids?.traceId ?? this.trace?.traceId;
      const base = this.opts.logger ?? silentLogger;
      this.requestLog = base.child(
        ids ? { reqId: this.id, traceId: ids.traceId, spanId: ids.spanId } : traceId ? { reqId: this.id, traceId } : { reqId: this.id },
      );
    }
    return this.requestLog;
  }

  /**
   * Contexto de trace W3C recebido no `traceparent` (F-38), já validado: `{ traceId, parentSpanId, sampled,
   * tracestate }`, ou `undefined` se não veio ou é inválido. Os logs do `ctx.log` levam o `traceId`.
   */
  get trace(): TraceContext | undefined {
    if (this.traceContext === null) {
      this.traceContext = parseTraceparent(this.req.headers.traceparent, this.req.headers.tracestate);
    }
    return this.traceContext;
  }
  private traceContext: TraceContext | undefined | null = null;

  // Campos preguiçosos (F-39, fase 2): calculados no primeiro acesso e guardados. Dependem só da
  // requisição e da configuração do app, que não mudam durante a requisição.
  /**
   * Configuração do app, **a mesma referência** para todas as requisições (Flyweight, F-41): o `Context` lê
   * dela em vez de copiar `trustProxy`, `onSend`, `queryMaxKeys` e o logger campo a campo.
   */
  private readonly opts: ContextOptions;
  private readonly target: RequestTarget;
  private parsedQuery: ParsedQuery | undefined;
  private fullUrl: URL | undefined;
  private requestLog: Logger | undefined;
  private memoHost: string | undefined;
  private memoHostname: string | undefined;
  private memoProtocol: 'http' | 'https' | undefined;
  /** Body; tipado pelo schema `body`. */
  body: InferBody<SchemasOf<S>> = undefined as InferBody<SchemasOf<S>>;
  /** Estado por requisição, criado no primeiro acesso (F-41). */
  get state(): ContextState {
    this.requestState ??= {};
    return this.requestState;
  }
  set state(value: ContextState) {
    this.requestState = value;
  }
  private requestState: ContextState | undefined;

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
      if (this.res.writableEnded) return controller.signal;
      // O cliente pode ter desconectado antes do primeiro acesso ao signal (num `await` anterior):
      // o evento 'close' já passou, então o estado precisa ser conferido agora.
      if (this.res.destroyed || this.req.destroyed || this.req.socket?.destroyed) {
        controller.abort(new RequestAbortedError('CLIENT_DISCONNECTED'));
        return controller.signal;
      }
      this.res.once('close', () => {
        // `writableEnded`: a resposta foi encerrada pelo app. `writableFinished` dependeria de o socket ter
        // recebido tudo, e no inject (sem socket) uma resposta bem-sucedida pareceria uma desconexão.
        if (!this.res.writableEnded) controller.abort(new RequestAbortedError('CLIENT_DISCONNECTED'));
      });
    }
    return this.abortController.signal;
  }

  /**
   * Por que esta requisição foi cancelada (`CLIENT_DISCONNECTED`, `SHUTDOWN`), ou `undefined` se não foi.
   * Atalho tipado para `ctx.signal.reason.code` (F-38).
   */
  get abortReason(): AbortCode | undefined {
    const reason: unknown = this.abortController?.signal.reason;
    return reason instanceof RequestAbortedError ? reason.code : undefined;
  }

  /** @internal `true` em respostas de streaming (SSE, NDJSON, `Readable`) já iniciadas. */
  get streamingResponse(): boolean {
    return this.streaming;
  }

  private markStreaming(): void {
    if (this.streaming) return;
    this.streaming = true;
    this.opts.onStream?.(this as unknown as Context);
  }

  /** @internal */
  [kAbort](code: AbortCode): void {
    void this.signal;
    this.abortController?.abort(new RequestAbortedError(code));
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
    return openSse(this as unknown as Context, opts, () => this.markStreaming());
  }

  /**
   * Envia um arquivo com `Content-Type`, `ETag`/`Last-Modified` (304) e `Range` (206), em stream (F-13).
   * Com `root`, o path é relativo e não pode sair dela; sem `root`, precisa ser absoluto.
   * Arquivo inexistente responde 404.
   */
  sendFile(path: string, opts?: SendFileOptions): Promise<void> {
    // O app aguarda este envio mesmo que o handler esqueça o `await`/`return`: sem isso, a resposta sairia
    // vazia e um erro (404, por exemplo) viraria um unhandledRejection.
    const pending = sendFile(this as unknown as Context, path, opts);
    this[kPendingSend] = pending;
    return pending;
  }

  /** @internal */
  [kPendingSend]: Promise<void> | undefined;

  /**
   * Corpo exatamente como foi escrito (F-04), depois do envio. Fica `undefined` em streams e em
   * respostas sem corpo. Útil para cache: `await next(); store.set(key, ctx.sentBody)`.
   */
  get sentBody(): Buffer | undefined {
    // Convertido só se alguém ler (F-39): antes, toda resposta copiava o corpo para um Buffer.
    if (this.sentBuffer === undefined && this.sentRaw !== undefined) {
      this.sentBuffer = typeof this.sentRaw === 'string' ? Buffer.from(this.sentRaw) : Buffer.from(this.sentRaw);
    }
    return this.sentBuffer;
  }
  set sentBody(value: Buffer | undefined) {
    this.sentBuffer = value;
    this.sentRaw = undefined;
  }
  private sentRaw: string | Uint8Array | undefined;
  private sentBuffer: Buffer | undefined;
  /** `Content-Type` da resposta enviada, junto com `sentBody`. */
  sentType: string | undefined;
  private bound: ResponsePlan | undefined;

  /**
   * @param opts configuração; o app passa **o mesmo objeto** para todas as requisições (Flyweight), e o
   *   que muda por requisição (`id`) vem à parte.
   */
  constructor(req: IncomingMessage, res: ServerResponse, opts: ContextOptions = {}, id?: string) {
    this.req = req;
    this.res = res;
    this.method = req.method ?? 'GET';
    this.opts = opts;
    // S-09: o path vem do request-target com base fixa; o host do cliente nunca entra no parsing.
    this.target = splitRequestTarget(req.url);
    this.path = this.target.pathname;
    this.id = id ?? opts.id ?? '';
  }

  /**
   * IP do cliente. Por padrão, o do socket. Com `trustProxy`, vem do `X-Forwarded-For`, que só deve
   * ser ligado atrás de um proxy que reescreve esse header (S-09).
   */
  get ip(): string {
    return pickForwarded(this.req.headers['x-forwarded-for'], this.opts.trustProxy ?? false) ?? this.req.socket.remoteAddress ?? '';
  }

  /**
   * Host da requisição (`api.exemplo.com:8080`), **validado**: um valor inválido vira `''`.
   * Com `trustProxy`, vem do `X-Forwarded-Host`. Para links absolutos, prefira uma URL base
   * configurada em vez do host pedido pelo cliente (S-09).
   */
  get host(): string {
    if (this.memoHost === undefined) {
      const forwarded = pickForwarded(this.req.headers['x-forwarded-host'], this.opts.trustProxy ?? false);
      const raw = forwarded !== undefined ? forwarded : this.req.headers.host;
      this.memoHost = isValidHost(raw) ? raw : '';
    }
    return this.memoHost;
  }

  /** `host` sem a porta. */
  get hostname(): string {
    this.memoHostname ??= this.host ? hostnameOf(this.host) : '';
    return this.memoHostname;
  }

  /** `https` se a conexão for TLS ou, com `trustProxy`, se o `X-Forwarded-Proto` disser; senão `http`. */
  get protocol(): 'http' | 'https' {
    if (this.memoProtocol === undefined) {
      const forwarded = pickForwarded(this.req.headers['x-forwarded-proto'], this.opts.trustProxy ?? false)?.toLowerCase();
      this.memoProtocol =
        forwarded === 'https' || forwarded === 'http'
          ? forwarded
          : (this.req.socket as { encrypted?: boolean }).encrypted
            ? 'https'
            : 'http';
    }
    return this.memoProtocol;
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
    const plan = this.bound;
    if (plan) sendResult(this as unknown as Context, plan.response, body, plan.serializers, mode, plan.defaultStatus);
    else sendResult(this as unknown as Context, undefined, body, undefined, mode);
    return this;
  }

  /** @internal Liga os schemas de resposta da rota (o app chama antes do handler). */
  [kBindResponse](plan: ResponsePlan): void {
    this.bound = plan;
  }

  /** @internal Envio cru, sem schema: string, bytes ou stream. */
  [kRawSend](body: RawBody, contentType?: string): this {
    if (this.sent) return this;
    const type = contentType ?? (this.res.getHeader('Content-Type') as string | undefined) ?? 'application/octet-stream';

    if (body instanceof Readable) {
      this.res.setHeader('Content-Type', type);
      this.markStreaming();
      pipeline(body, this.res).catch((err: unknown) => {
        // P-12: o cliente desistir (fechar a conexão) é normal e não é erro do servidor.
        // Pelo código do erro: o pipeline já destruiu a resposta aqui, então `res.destroyed` não distingue.
        const clientGone = isClientDisconnect(err);
        this.log[clientGone ? 'debug' : 'error'](
          { err, method: this.method, path: this.path },
          clientGone ? 'client disconnected during stream' : 'stream failed',
        );
        this.res.destroy(err as Error);
      });
      return this;
    }
    // Content-Type escrito uma vez só, depois do onSend (antes: duas vezes por resposta).
    const hooks = this.opts.onSend;
    const payload = hooks && hooks.length > 0 ? this.runOnSend({ body, contentType: type }) : { body, contentType: type };
    this.res.setHeader('Content-Type', payload.contentType);
    this.sentRaw = payload.body;
    this.sentBuffer = undefined;
    this.sentType = payload.contentType;
    this.res.end(payload.body);
    return this;
  }

  /** Aplica os `onSend`; se algum lançar, loga e envia o payload original (F-04). */
  private runOnSend(original: SendPayload): SendPayload {
    let payload = original;
    try {
      for (const hook of this.opts.onSend ?? []) payload = hook(this as unknown as Context, payload) ?? payload;
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

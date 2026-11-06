import type { IncomingMessage, OutgoingHttpHeader, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from './errors.ts';
import { parseQuery, type ParsedQuery } from '../utils/query.ts';
import { silentLogger, type Logger } from './logger.ts';
import type { InferBody, InferParams, InferQuery } from './infer.ts';
import type { RouteSchemas } from './metadata.ts';

/**
 * Estado por requisição, compartilhado entre middlewares, guards e handlers.
 * Estenda com declaration merging para ter tipos (F-01):
 *
 * ```ts
 * declare module 'picodecor' {
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

  constructor(req: IncomingMessage, res: ServerResponse, opts: ContextOptions = {}) {
    this.req = req;
    this.res = res;
    this.method = req.method ?? 'GET';
    this.url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    this.path = this.url.pathname;
    this.query = parseQuery(this.url.searchParams, opts.queryMaxKeys) as ParsedQuery as InferQuery<S>;
    this.id = opts.id ?? '';
    this.log = (opts.logger ?? silentLogger).child({ reqId: this.id });
  }

  /** IP do cliente conforme o socket. Sem `trustProxy`, `X-Forwarded-For` é ignorado (S-09). */
  get ip(): string {
    return this.req.socket.remoteAddress ?? '';
  }

  status(code: number): this {
    this.res.statusCode = code;
    this.statusExplicit = true;
    return this;
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

  /** Define um header da resposta. */
  header(name: string, value: OutgoingHttpHeader): this {
    this.res.setHeader(name, value);
    return this;
  }

  json(data: unknown): this {
    if (this.sent) return this;
    this.res.setHeader('Content-Type', 'application/json; charset=utf-8');
    this.res.end(JSON.stringify(data));
    return this;
  }

  /** Resposta em texto puro (`text/plain; charset=utf-8`). */
  text(data: string): this {
    return this.send(data, 'text/plain; charset=utf-8');
  }

  /**
   * Envia string, Buffer/Uint8Array ou stream (`Readable`). O `Content-Type` padrão é
   * `application/octet-stream`; passe o tipo correto. Para HTML, faça o escape do conteúdo
   * dinâmico antes: o framework não faz isso por você (S-02).
   */
  send(body: string | Uint8Array | Readable, contentType?: string): this {
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
    this.res.end(body);
    return this;
  }

  /**
   * Redireciona (padrão 302). Não use `url` vinda do usuário sem validar: isso abre um
   * open redirect. Prefira caminhos relativos ou uma lista de destinos permitidos.
   */
  redirect(url: string, status: 301 | 302 | 303 | 307 | 308 = 302): this {
    if (this.sent) return this;
    this.status(status);
    this.res.setHeader('Location', url);
    this.res.end();
    return this;
  }

  throw(status: number, message: string, code?: string): never {
    throw new HttpError(status, message, code);
  }
}
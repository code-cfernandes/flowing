import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from './errors.ts';
import { parseQuery, type ParsedQuery } from '../utils/query.ts';

export interface ContextOptions {
  queryMaxKeys?: number | undefined;
}

export class Context {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly path: string;
  readonly url: URL;

  params: Record<string, string> = {};
  query: ParsedQuery = {};
  body: unknown = undefined;
  state: Record<string, unknown> = {};

  /** `true` quando o handler chamou `ctx.status()`. Usado para escolher o schema de resposta (B-05). */
  statusExplicit = false;

  constructor(req: IncomingMessage, res: ServerResponse, opts: ContextOptions = {}) {
    this.req = req;
    this.res = res;
    this.method = req.method ?? 'GET';
    this.url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    this.path = this.url.pathname;
    this.query = parseQuery(this.url.searchParams, opts.queryMaxKeys);
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

  json(data: unknown): this {
    if (this.res.writableEnded) return this;
    this.res.setHeader('Content-Type', 'application/json; charset=utf-8');
    this.res.end(JSON.stringify(data));
    return this;
  }

  throw(status: number, message: string, code?: string): never {
    throw new HttpError(status, message, code);
  }
}
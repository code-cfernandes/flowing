import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from './errors.ts';

export class Context {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly path: string;
  readonly url: URL;

  params: Record<string, string> = {};
  query: Record<string, string | string[]> = {};
  body: unknown = undefined;
  state: Record<string, unknown> = {};

  constructor(req: IncomingMessage, res: ServerResponse) {
    this.req = req;
    this.res = res;
    this.method = req.method ?? 'GET';
    this.url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    this.path = this.url.pathname;
    this.query = Object.fromEntries(this.url.searchParams);
  }

  /** IP do cliente conforme o socket. Sem `trustProxy`, `X-Forwarded-For` é ignorado (S-09). */
  get ip(): string {
    return this.req.socket.remoteAddress ?? '';
  }

  status(code: number): this {
    this.res.statusCode = code;
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
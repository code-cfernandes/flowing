import http from 'node:http';
import { compileController } from './compiler.ts';
import { compose, type Middleware } from './compose.ts';
import { Context } from './context.ts';
import { HttpError, badRequest } from './errors.ts';
import '../shims/symbol-metadata.ts';
import { PicoDecorRouter } from './router.ts';
import { serialize } from '../schema/serialization.ts';
import { validate } from '../schema/validation.ts';

export interface AppOptions {
  bodyLimit?: number;
}

export class PicoDecorApp {
  private middlewares: Middleware[] = [];
  private router = new PicoDecorRouter();
  private errorHandlers: ((err: unknown, ctx: Context) => void | Promise<void>)[] = [];

  constructor(opts: AppOptions = {}) {
    const limit = opts.bodyLimit ?? 1024 * 1024;
    this.use(bodyParser(limit));
  }

  use(mw: Middleware): this {
    this.middlewares.push(mw);
    return this;
  }

  onError(h: (err: unknown, ctx: Context) => void | Promise<void>): this {
    this.errorHandlers.push(h);
    return this;
  }

  controllers(classes: (new () => any)[]): this {
    for (const Class of classes) {
      for (const route of compileController(Class)) {
        this.router.on(route.method, route.path, route.handler, route.schemas);
      }
    }
    return this;
  }

  async handle(ctx: Context): Promise<void> {
    try {
      await compose(ctx, this.middlewares);
      if (ctx.res.writableEnded) return;

      const match = this.router.find(ctx.method, ctx.path);
      if (!match) {
        const allowed = this.router.allowedMethods(ctx.path);
        if (allowed.length > 0) {
          ctx.res.setHeader('Allow', allowed.join(', '));
          return void ctx.status(405).json({ error: 'Method Not Allowed', allowed });
        }
        return void ctx.status(404).json({ error: 'Not Found' });
      }

      ctx.params = match.params;

      if (match.schemas.params && !validate(match.schemas.params, ctx.params))
        throw badRequest('Invalid params');
      if (match.schemas.query && !validate(match.schemas.query, ctx.query))
        throw badRequest('Invalid query');
      if (match.schemas.body && !validate(match.schemas.body, ctx.body))
        throw badRequest('Invalid body');

      const result = await match.handler(ctx);
      if (ctx.res.writableEnded) return;

      const status = ctx.res.statusCode || 200;
      const schema = match.schemas.response?.[status];

      if (schema) {
        ctx.res.setHeader('Content-Type', 'application/json; charset=utf-8');
        ctx.res.end(serialize(schema, result));
      } else if (result !== undefined) {
        ctx.json(result);
      } else {
        ctx.res.end();
      }
    } catch (err) {
      for (const h of this.errorHandlers) {
        await h(err, ctx);
        if (ctx.res.writableEnded) return;
      }
      sendError(ctx, err);
    }
  }

  listen(port: number, host = '127.0.0.1'): http.Server {
    const server = http.createServer((req, res) => void this.handle(new Context(req, res)));
    server.listen(port, host);
    return server;
  }
}

const GENERIC_500 = 'Internal Server Error';

/**
 * Resposta de erro padrão. Só mensagens marcadas como `expose` chegam ao cliente;
 * o resto vira 500 genérico e o erro original é logado no servidor (S-05).
 */
function sendError(ctx: Context, err: unknown): void {
  const httpErr = err instanceof HttpError ? err : undefined;
  const status = httpErr?.status ?? 500;
  const exposed = httpErr?.expose === true;

  if (!exposed) console.error(`[picodecor] ${ctx.method} ${ctx.path} → ${status}`, err);
  if (ctx.res.writableEnded) return;
  if (ctx.res.headersSent) return void ctx.res.end();

  ctx.status(status).json({ error: exposed ? httpErr!.message : GENERIC_500 });
}

export function createApp(opts?: AppOptions): PicoDecorApp {
  return new PicoDecorApp(opts);
}

function bodyParser(limit: number): Middleware {
  return async (ctx, next) => {
    if (ctx.method === 'GET' || ctx.method === 'HEAD') return next();
    const ct = ctx.req.headers['content-type'] ?? '';
    if (!ct.includes('application/json')) return next();

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of ctx.req) {
      size += chunk.length;
      if (size > limit) ctx.throw(413, 'Payload too large');
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw) {
      try { ctx.body = JSON.parse(raw); }
      catch { ctx.throw(400, 'Invalid JSON'); }
    }
    await next();
  };
}
import http from 'node:http';
import { compileController } from './compiler.ts';
import { compose, type Middleware } from './compose.ts';
import { Context } from './context.ts';
import { HttpError } from './errors.ts';
import '../shims/symbol-metadata.ts';
import type { RouteSchemas } from './metadata.ts';
import { PicoDecorRouter } from './router.ts';
import { serialize } from '../schema/serialization.ts';
import { validate, type ValidationTarget } from '../schema/validation.ts';

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

      validateRequest(ctx, match.schemas);

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
      await this.runErrorHandlers(err, ctx);
    }
  }

  /**
   * Executa os `onError` do usuário. Se um deles lançar, o erro é logado e seguimos
   * para a resposta padrão com o erro **original** — nunca deixamos a Promise rejeitar (B-08).
   */
  private async runErrorHandlers(err: unknown, ctx: Context): Promise<void> {
    for (const h of this.errorHandlers) {
      try {
        await h(err, ctx);
      } catch (handlerErr) {
        console.error(`[picodecor] onError handler failed on ${ctx.method} ${ctx.path}`, handlerErr);
        break;
      }
      if (ctx.res.writableEnded) return;
    }
    sendError(ctx, err);
  }

  listen(port: number, host = '127.0.0.1'): http.Server {
    const server = http.createServer((req, res) => {
      // Última barreira (B-08): nada que aconteça numa requisição pode virar unhandledRejection.
      const fail = (err: unknown) => {
        console.error('[picodecor] unhandled error while handling request', err);
        if (!res.headersSent) res.statusCode = 500;
        if (!res.writableEnded) res.end();
      };
      try {
        this.handle(new Context(req, res)).catch(fail);
      } catch (err) {
        fail(err);
      }
    });
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

  const body: { error: string; details?: unknown } = { error: exposed ? httpErr!.message : GENERIC_500 };
  if (exposed && httpErr!.details !== undefined) body.details = httpErr!.details;
  ctx.status(status).json(body);
}

const VALIDATION_ORDER: readonly ValidationTarget[] = ['headers', 'params', 'query', 'body'];
const TARGET_LABEL: Record<ValidationTarget, string> = {
  headers: 'Invalid headers', params: 'Invalid params', query: 'Invalid query', body: 'Invalid body',
};

/** Valida cada parte da requisição que tiver schema; o primeiro erro vira 400 com detalhes (B-02/B-03). */
function validateRequest(ctx: Context, schemas: RouteSchemas): void {
  for (const target of VALIDATION_ORDER) {
    const schema = schemas[target];
    if (!schema) continue;
    // Headers: validamos uma cópia, para coerção/defaults não alterarem `req.headers`.
    const data = target === 'headers' ? { ...ctx.req.headers } : ctx[target];
    const issues = validate(schema, data, target);
    if (issues) throw new HttpError(400, TARGET_LABEL[target], 'VALIDATION_ERROR', { details: issues });
  }
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
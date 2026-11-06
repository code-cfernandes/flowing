import http from 'node:http';
import { compileController, type ControllerRef } from './compiler.ts';
import { compose, type Middleware } from './compose.ts';
import { Context } from './context.ts';
import '../shims/symbol-metadata.ts';
import { bodyParser } from './body-parser.ts';
import { assertSchemas, validateRequest } from './request-validation.ts';
import { sendError, sendResult } from './response.ts';
import { PicoDecorRouter } from './router.ts';
import { buildSecurityHeaders, type SecurityHeadersOptions } from '../middlewares/security-headers.ts';

export interface ServerTimeouts {
  /** Tempo máximo para receber a requisição inteira. Padrão: 30s. */
  requestTimeout?: number;
  /** Tempo máximo para receber os headers (mitiga Slowloris). Padrão: 10s. */
  headersTimeout?: number;
  /** Tempo de conexão keep-alive ociosa. Padrão: 5s. */
  keepAliveTimeout?: number;
}

export interface AppOptions {
  /** Tamanho máximo do body JSON em bytes. Padrão: 1 MiB. */
  bodyLimit?: number;
  /** Headers de segurança aplicados a toda resposta (S-04). Ligado por padrão; `false` desliga. */
  securityHeaders?: SecurityHeadersOptions | false;
  /** Timeouts do servidor HTTP (S-06). */
  timeouts?: ServerTimeouts;
  /**
   * Modo estrito (S-07): exige schema de `body` em POST/PUT/PATCH e schema de `response`
   * em toda rota, falhando no registro do controller. Padrão: `false`.
   */
  requireSchemas?: boolean;
  /** Máximo de pares chave/valor lidos da query string. Padrão: 1000 (S-06). */
  queryMaxKeys?: number;
}

export class PicoDecorApp {
  private middlewares: Middleware[] = [];
  private router = new PicoDecorRouter();
  private errorHandlers: ((err: unknown, ctx: Context) => void | Promise<void>)[] = [];
  private applySecurityHeaders: ((res: http.ServerResponse) => void) | undefined;
  private readonly opts: AppOptions;

  constructor(opts: AppOptions = {}) {
    this.opts = opts;
    if (opts.securityHeaders !== false) this.applySecurityHeaders = buildSecurityHeaders(opts.securityHeaders);
    this.use(bodyParser(opts.bodyLimit ?? 1024 * 1024));
  }

  use(mw: Middleware): this {
    this.middlewares.push(mw);
    return this;
  }

  onError(h: (err: unknown, ctx: Context) => void | Promise<void>): this {
    this.errorHandlers.push(h);
    return this;
  }

  /** Registra controllers: classes (`new X()` sem argumentos) ou instâncias prontas (B-10). */
  controllers(refs: ControllerRef[]): this {
    for (const ref of refs) {
      const name = typeof ref === 'function' ? ref.name : ref.constructor.name;
      for (const route of compileController(ref)) {
        if (this.opts.requireSchemas) assertSchemas(name, route);
        this.router.on(route.method, route.path, route.handler, route.schemas);
      }
    }
    return this;
  }

  async handle(ctx: Context): Promise<void> {
    // Antes de tudo, para valer inclusive em erros, 404 e preflight (S-04).
    this.applySecurityHeaders?.(ctx.res);
    try {
      await compose(ctx, this.middlewares);
      if (ctx.res.writableEnded) return;

      const match = this.router.find(ctx.method, ctx.path);
      if (!match) {
        const allowed = this.router.allowedMethods(ctx.path);
        if (allowed.length > 0) {
          ctx.res.setHeader('Allow', allowed.join(', '));
          // F-08: OPTIONS automático para qualquer path com rotas.
          if (ctx.method === 'OPTIONS') return void ctx.status(204).res.end();
          return void ctx.status(405).json({ error: 'Method Not Allowed', allowed });
        }
        return void ctx.status(404).json({ error: 'Not Found' });
      }

      ctx.params = match.params;

      validateRequest(ctx, match.schemas);

      const result = await match.handler(ctx);
      if (ctx.res.writableEnded) return;

      sendResult(ctx, match.schemas.response, result);
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
        this.handle(new Context(req, res, { queryMaxKeys: this.opts.queryMaxKeys })).catch(fail);
      } catch (err) {
        fail(err);
      }
    });
    const t = this.opts.timeouts ?? {};
    server.requestTimeout = t.requestTimeout ?? 30_000;
    server.headersTimeout = Math.min(t.headersTimeout ?? 10_000, server.requestTimeout || Infinity);
    server.keepAliveTimeout = t.keepAliveTimeout ?? 5_000;
    server.listen(port, host);
    return server;
  }
}

export function createApp(opts?: AppOptions): PicoDecorApp {
  return new PicoDecorApp(opts);
}

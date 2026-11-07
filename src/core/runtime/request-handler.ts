import { randomUUID } from 'node:crypto';
import type http from 'node:http';
import { performance } from 'node:perf_hooks';
import type { AppCore } from '../app/core.ts';
import { compileChain } from '../compose.ts';
import { bodyReader } from '../body-parser.ts';
import { buildRouteProgram } from '../registry/route-program.ts';
import { kContext, kRouted } from '../symbols.ts';
import { Context } from '../context.ts';
import type { FrameworkRoutes } from '../registry/framework-routes.ts';
import type { RouteRegistry } from '../registry/registry.ts';
import { problem, sendError, sendProblem } from '../response/pipeline.ts';
import type { ServerLifecycle } from './server.ts';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Pipeline da requisição: rastreamento, request id, validação do `Host`, headers de segurança, healthchecks,
 * middlewares globais, OpenAPI, roteamento, pipeline da rota e erros.
 */
export class RequestHandler {
  constructor(
    private readonly core: AppCore,
    private readonly registry: RouteRegistry,
    private readonly framework: FrameworkRoutes,
    private readonly server: ServerLifecycle,
  ) {
    this.readBody = bodyReader(core.opts.bodyLimit ?? 1024 * 1024, core.opts.protoPoisoning);
  }

  /**
   * Listener `(req, res)` do app, para usar com qualquer servidor do Node:
   * `https.createServer(opts, app.callback())`, `http2` em modo compat, testes etc. (F-09).
   */
  callback(): (req: http.IncomingMessage, res: http.ServerResponse) => void {
    const rid = this.core.opts.requestId ?? {};
    const header = rid.header === false ? undefined : (rid.header ?? 'x-request-id').toLowerCase();
    const trust = rid.trustIncoming ?? true;
    const generate = rid.generate ?? (() => randomUUID());

    // Factory + Flyweight (F-39): a mesma configuração para todos os contextos deste listener, em vez de
    // um objeto de opções novo a cada requisição.
    const contextOptions = {
      queryMaxKeys: this.core.opts.queryMaxKeys,
      logger: this.core.log,
      trustProxy: this.core.opts.trustProxy,
      onSend: this.core.onSendHooks,
    };

    const server = this.server;
    // Listener compartilhado por todas as respostas (antes, uma closure por requisição).
    const onClose = function (this: http.ServerResponse) {
      server.inflight.delete(this);
      // Durante o close(), cada resposta concluída libera as conexões que ficaram ociosas.
      server.closing?.closeIdleConnections();
    };
    const timed = () => this.core.opts.logRequests === true || this.core.onResponseHooks.length > 0;

    return (req, res) => {
      const started = timed() ? performance.now() : -1;
      server.inflight.add(res);
      if (server.closing) res.setHeader('Connection', 'close');
      res.on('close', onClose);
      const incoming = header ? req.headers[header] : undefined;
      const id = trust && typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : generate();
      if (header) res.setHeader(header, id);

      try {
        const ctx = new Context(req, res, contextOptions, id);
        (res as unknown as Record<symbol, Context>)[kContext] = ctx;
        // S-09: Host ausente, malformado ou fora da lista permitida → 400, antes de qualquer middleware.
        // Exceção: healthchecks aceitam qualquer host válido, porque sondas chegam com o IP do pod.
        const healthProbe = this.framework.health?.bypassesHostCheck(ctx.method, ctx.path) ?? false;
        if (!ctx.host || (this.core.allowedHosts && !healthProbe && !this.core.allowedHosts(ctx.hostname, ctx.host))) {
          this.core.applySecurityHeaders?.(res);
          sendProblem(ctx, problem(400, 'Invalid Host header', { code: 'INVALID_HOST' }), this.core.opts.formatError);
          return;
        }
        if (started !== -1) {
          res.once('finish', () => {
            const ms = Math.round((performance.now() - started) * 100) / 100;
            if (this.core.opts.logRequests) {
              ctx.log.info({ method: ctx.method, path: ctx.path, status: res.statusCode, ms }, 'request completed');
            }
            for (const hook of this.core.onResponseHooks) {
              Promise.resolve()
                .then(() => hook(ctx, { status: res.statusCode, ms }))
                .catch((err: unknown) => ctx.log.error({ err }, 'onResponse hook failed'));
            }
          });
        }
        void this.safeHandle(ctx, id);
      } catch (err) {
        this.fail(err, req, res, id);
      }
    };
  }

  /** Última barreira (B-08): nada que aconteça numa requisição pode virar unhandledRejection. */
  private async safeHandle(ctx: Context, id: string): Promise<void> {
    try {
      await this.handle(ctx);
    } catch (err) {
      this.fail(err, ctx.req, ctx.res, id);
    }
  }

  private fail(err: unknown, req: http.IncomingMessage, res: http.ServerResponse, id: string): void {
    this.core.log.error({ err, reqId: id, method: req.method, url: req.url }, 'unhandled error while handling request');
    if (!res.headersSent) res.statusCode = 500;
    if (!res.writableEnded) res.end();
  }

  /** Cadeia global compilada; refeita só quando `app.use()` acrescenta um middleware. */
  private globalChain: { size: number; run: (ctx: Context) => Promise<void> } | undefined;
  private readonly readBody: (ctx: Context) => Promise<void> | undefined;

  async handle(ctx: Context): Promise<void> {
    // Antes de tudo, para valer inclusive em erros, 404 e preflight (S-04).
    this.core.applySecurityHeaders?.(ctx.res);
    try {
      // Healthchecks antes dos middlewares globais: sondas do load balancer não têm credenciais.
      if (this.framework.health && (await this.framework.health.serve(ctx, this.server.draining || this.server.closing !== undefined)))
        return;
      // O body chega lido aos middlewares globais (invariante 5), sem uma camada de middleware para isso.
      const reading = this.readBody(ctx);
      if (reading) await reading;
      const chain = this.chain();
      await chain(ctx);
      // Um middleware global que não chama next() e não responde: a rota não roda (antes, rodava mesmo
      // assim). Para a requisição não ficar sem resposta, 404, como no Koa.
      if (!(ctx as unknown as Record<symbol, boolean>)[kRouted] && !ctx.sent) {
        ctx.log.warn({ method: ctx.method, path: ctx.path }, 'a global middleware neither called next() nor sent a response');
        sendProblem(ctx, problem(404, undefined, { code: 'NOT_FOUND' }), this.core.opts.formatError);
      }
    } catch (err) {
      await this.runErrorHandlers(err, ctx);
    }
  }

  /**
   * Cadeia global (Chain of Responsibility pré-compilada): os middlewares de `app.use()` envolvem o
   * roteamento e a rota, como no Koa. Um `await next()` num middleware global inclui o handler.
   */
  private chain(): (ctx: Context) => Promise<void> {
    const mws = this.core.middlewares;
    if (this.globalChain?.size !== mws.length) {
      this.globalChain = { size: mws.length, run: compileChain([...mws], (ctx) => this.route(ctx)) };
    }
    return this.globalChain.run;
  }

  /** Fim da cadeia global: OpenAPI, roteamento, 404/405 e o programa da rota. */
  private async route(ctx: Context): Promise<void> {
    (ctx as unknown as Record<symbol, boolean>)[kRouted] = true;
    if (ctx.sent) return;
    // Só cria a Promise do OpenAPI se ele estiver configurado (F-41).
    if (this.framework.openapi && (await this.framework.serveOpenAPI(ctx))) return;

    // F-35: hosts não diferenciam maiúsculas; as regras já são compiladas em minúsculas.
    const hostname = ctx.hostname.toLowerCase();
    const match = this.registry.router.find(ctx.method, ctx.path, hostname);
    if (!match) {
      const allowed = this.registry.router.allowedMethods(ctx.path, hostname);
      if (allowed.length > 0) {
        ctx.res.setHeader('Allow', allowed.join(', '));
        // F-08: OPTIONS automático para qualquer path com rotas.
        if (ctx.method === 'OPTIONS') return void ctx.status(204).res.end();
        return void sendProblem(
          ctx,
          problem(405, undefined, { code: 'METHOD_NOT_ALLOWED', details: { allowed } }),
          this.core.opts.formatError,
        );
      }
      return void sendProblem(ctx, problem(404, undefined, { code: 'NOT_FOUND' }), this.core.opts.formatError);
    }
    ctx.params = match.params;
    // O programa é montado no commit do registro; o fallback cobre rotas registradas por fora dele.
    const run = (match.route.run ??= buildRouteProgram(match.route, this.core.serializers));
    await run(ctx);
  }

  /**
   * Executa os `onError` do usuário. Se um deles lançar, o erro é logado e seguimos
   * para a resposta padrão com o erro **original** — nunca deixamos a Promise rejeitar (B-08).
   */
  private async runErrorHandlers(err: unknown, ctx: Context): Promise<void> {
    for (const h of this.core.errorHandlers) {
      try {
        await h(err, ctx);
      } catch (handlerErr) {
        ctx.log.error({ err: handlerErr, method: ctx.method, path: ctx.path }, 'onError handler failed');
        break;
      }
      if (ctx.res.writableEnded) return;
    }
    sendError(ctx, err, this.core.opts.formatError);
  }
}

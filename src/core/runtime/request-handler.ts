import { randomUUID } from 'node:crypto';
import type http from 'node:http';
import { performance } from 'node:perf_hooks';
import type { AppCore } from '../app/core.ts';
import { compose, type Middleware } from '../compose.ts';
import { Context } from '../context.ts';
import { guardsMiddleware } from '../guard.ts';
import type { FrameworkRoutes } from '../registry/framework-routes.ts';
import type { RouteRegistry } from '../registry/registry.ts';
import { validateRequest } from '../request-validation.ts';
import { problem, sendError, sendProblem, sendResult } from '../response/pipeline.ts';
import { kBindResponse, kPendingSend } from '../symbols.ts';
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
  ) {}

  /**
   * Listener `(req, res)` do app, para usar com qualquer servidor do Node:
   * `https.createServer(opts, app.callback())`, `http2` em modo compat, testes etc. (F-09).
   */
  callback(): (req: http.IncomingMessage, res: http.ServerResponse) => void {
    const rid = this.core.opts.requestId ?? {};
    const header = rid.header === false ? undefined : (rid.header ?? 'x-request-id').toLowerCase();
    const trust = rid.trustIncoming ?? true;
    const generate = rid.generate ?? (() => randomUUID());

    return (req, res) => {
      const started = performance.now();
      this.server.inflight.add(res);
      if (this.server.closing) res.setHeader('Connection', 'close');
      res.once('close', () => {
        this.server.inflight.delete(res);
        // Durante o close(), cada resposta concluída libera as conexões que ficaram ociosas.
        this.server.closing?.closeIdleConnections();
      });
      const incoming = header ? req.headers[header] : undefined;
      const id = trust && typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : generate();
      if (header) res.setHeader(header, id);

      // Última barreira (B-08): nada que aconteça numa requisição pode virar unhandledRejection.
      const fail = (err: unknown) => {
        this.core.log.error({ err, reqId: id, method: req.method, url: req.url }, 'unhandled error while handling request');
        if (!res.headersSent) res.statusCode = 500;
        if (!res.writableEnded) res.end();
      };
      try {
        const ctx = new Context(req, res, {
          queryMaxKeys: this.core.opts.queryMaxKeys,
          id,
          logger: this.core.log,
          trustProxy: this.core.opts.trustProxy,
          onSend: this.core.onSendHooks,
        });
        this.server.contexts.set(res, ctx);
        // S-09: Host ausente, malformado ou fora da lista permitida → 400, antes de qualquer middleware.
        // Exceção: healthchecks aceitam qualquer host válido, porque sondas chegam com o IP do pod.
        const healthProbe = this.framework.health?.bypassesHostCheck(ctx.method, ctx.path) ?? false;
        if (!ctx.host || (this.core.allowedHosts && !healthProbe && !this.core.allowedHosts(ctx.hostname, ctx.host))) {
          this.core.applySecurityHeaders?.(res);
          sendProblem(ctx, problem(400, 'Invalid Host header', { code: 'INVALID_HOST' }), this.core.opts.formatError);
          return;
        }
        if (this.core.opts.logRequests || this.core.onResponseHooks.length > 0) {
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
        this.handle(ctx).catch(fail);
      } catch (err) {
        fail(err);
      }
    };
  }

  async handle(ctx: Context): Promise<void> {
    // Antes de tudo, para valer inclusive em erros, 404 e preflight (S-04).
    this.core.applySecurityHeaders?.(ctx.res);
    try {
      // Healthchecks antes dos middlewares globais: sondas do load balancer não têm credenciais.
      if (this.framework.health && (await this.framework.health.serve(ctx, this.server.draining || this.server.closing !== undefined)))
        return;
      await compose(ctx, this.core.middlewares);
      if (ctx.sent || (await this.framework.serveOpenAPI(ctx))) return;

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

      // F-01: middlewares → guards → validação → handler. Guards antes da validação, para que
      // quem não tem acesso receba 401/403 e não um 400 que revele a estrutura esperada.
      const route = match;
      const pipeline: Middleware[] = [...route.middlewares];
      if (route.guards.length > 0) pipeline.push(guardsMiddleware(route.guards));
      pipeline.push(async () => {
        validateRequest(ctx, route.schemas);
        // F-32: a partir daqui, ctx.json/send/text passam pelo mesmo pipeline do `return`.
        ctx[kBindResponse](route.schemas.response, this.core.serializers);
        const result = await route.handler(ctx);
        if (ctx[kPendingSend]) await ctx[kPendingSend];
        if (!ctx.sent) sendResult(ctx, route.schemas.response, result, this.core.serializers);
      });
      await compose(ctx, pipeline);
    } catch (err) {
      await this.runErrorHandlers(err, ctx);
    }
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

import { randomUUID } from 'node:crypto';
import type http from 'node:http';
import { performance } from 'node:perf_hooks';
import type { AppCore } from '../app/core.ts';
import { compileChain, isPromiseLike, type Step } from '../compose.ts';
import { bodyReader } from '../body-parser.ts';
import { buildRouteProgram } from '../registry/route-program.ts';
import type { RouteInfo } from '../route-table.ts';
import { kError, kRoute, kRouted } from '../symbols.ts';
import type { ResponseInfo } from '../app/options.ts';
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
      onStream: (ctx: Context) => {
        server.streams.add(ctx);
        ctx.res.once('close', () => server.streams.delete(ctx));
      },
    };

    const server = this.server;
    // Listener compartilhado por todas as respostas (antes, uma closure por requisição).
    const onClose = () => {
      // Durante o close(), cada resposta concluída libera as conexões que ficaram ociosas.
      server.closing?.closeIdleConnections();
    };
    const timed = () => this.core.opts.logRequests === true || this.core.onResponseHooks.length > 0;

    return (req, res) => {
      const started = timed() ? performance.now() : -1;
      if (server.closing) res.setHeader('Connection', 'close');
      res.on('close', onClose);
      const incoming = header ? req.headers[header] : undefined;
      const id = trust && typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : generate();
      if (header) res.setHeader(header, id);

      try {
        const ctx = new Context(req, res, contextOptions, id);
        // Antes da validação do Host: toda requisição observada no início também é observada no fim.
        if (started !== -1) this.observe(ctx, started);
        if (this.core.onRequestHooks.length > 0) this.runOnRequest(ctx);
        // S-09: Host ausente, malformado ou fora da lista permitida → 400, antes de qualquer middleware.
        // Exceção: healthchecks aceitam qualquer host válido, porque sondas chegam com o IP do pod.
        const healthProbe = this.framework.health?.bypassesHostCheck(ctx.method, ctx.path) ?? false;
        if (!ctx.host || (this.core.allowedHosts && !healthProbe && !this.core.allowedHosts(ctx.hostname, ctx.host))) {
          this.core.applySecurityHeaders?.(res);
          sendProblem(ctx, problem(400, 'Invalid Host header', { code: 'INVALID_HOST' }), this.core.opts.formatError);
          return;
        }
        // Síncrono no caso comum: só uma requisição que de fato ficou assíncrona recebe o handler da barreira.
        const step = this.run(ctx);
        if (step) step.then(undefined, (err: unknown) => this.fail(err, req, res, id));
      } catch (err) {
        this.fail(err, req, res, id);
      }
    };
  }

  /**
   * Fim da requisição para `onResponse` e `logRequests` (F-38): o evento `close` dispara em todos os caminhos
   * (inclusive cancelamento, que não tem `finish`), e a trava garante uma única execução. Só é ligado quando
   * há quem observe, então uma requisição sem hooks não paga nada.
   */
  private observe(ctx: Context, started: number): void {
    const res = ctx.res;
    let ttfb = -1;
    // O Node chama `this.writeHead` também nos headers implícitos (`write`/`end` sem `writeHead`).
    const writeHead = res.writeHead as (...args: unknown[]) => http.ServerResponse;
    (res as { writeHead: unknown }).writeHead = function (this: http.ServerResponse, ...args: unknown[]) {
      if (ttfb === -1) ttfb = performance.now();
      return writeHead.apply(this, args);
    };
    let done = false;
    res.once('close', () => {
      if (done) return;
      done = true;
      const round = (t: number) => Math.round((t - started) * 100) / 100;
      const abortReason = ctx.abortReason ?? (res.writableEnded ? undefined : 'CLIENT_DISCONNECTED');
      const status = res.statusCode;
      const error = (ctx as unknown as Record<symbol, unknown>)[kError];
      const route = ctx.route;
      const info: ResponseInfo = {
        status,
        ms: round(performance.now()),
        outcome: abortReason ? 'aborted' : status >= 500 ? 'error' : 'completed',
        streaming: ctx.streamingResponse,
        ...(abortReason ? { abortReason } : {}),
        ...(ttfb === -1 ? {} : { ttfbMs: round(ttfb) }),
        ...(route ? { route } : {}),
        ...(error === undefined ? {} : { error }),
      };
      if (this.core.opts.logRequests) {
        const entry = { method: ctx.method, path: ctx.path, status, ms: info.ms, ...(abortReason ? { abortReason } : {}) };
        ctx.log.info(entry, abortReason ? 'request aborted' : 'request completed');
      }
      for (const hook of this.core.onResponseHooks) {
        Promise.resolve()
          .then(() => hook(ctx, info))
          .catch((err: unknown) => ctx.log.error({ err }, 'onResponse hook failed'));
      }
    });
  }

  /** `onRequest` é síncrono: uma Promise devolvida não é esperada, mas a rejeição é logada. */
  private runOnRequest(ctx: Context): void {
    for (const hook of this.core.onRequestHooks) {
      try {
        const out: unknown = hook(ctx);
        if (isPromiseLike(out)) out.then(undefined, (err: unknown) => ctx.log.error({ err }, 'onRequest hook failed'));
      } catch (err) {
        ctx.log.error({ err }, 'onRequest hook failed');
      }
    }
  }

  // Última barreira (B-08): `fail` recebe o que escapar, de forma síncrona (try/catch) ou assíncrona (.then).

  private fail(err: unknown, req: http.IncomingMessage, res: http.ServerResponse, id: string): void {
    this.core.log.error({ err, reqId: id, method: req.method, url: req.url }, 'unhandled error while handling request');
    if (!res.headersSent) res.statusCode = 500;
    if (!res.writableEnded) res.end();
  }

  /** Cadeia global compilada; refeita só quando `app.use()` acrescenta um middleware. */
  private globalChain: { size: number; run: (ctx: Context) => Step } | undefined;
  private readonly readBody: (ctx: Context) => Promise<void> | undefined;

  /** O pipeline completo, como uma Promise (API pública: `app.handle()`). */
  async handle(ctx: Context): Promise<void> {
    await this.run(ctx);
  }

  /**
   * O pipeline completo. Síncrono do começo ao fim quando nada é assíncrono (sem healthcheck no path, sem
   * body a ler, sem middlewares, handler síncrono); vira assíncrono só a partir da primeira Promise de verdade
   * (F-41). Erros síncronos e assíncronos terminam no mesmo `runErrorHandlers`.
   */
  run(ctx: Context): Step {
    // Antes de tudo, para valer inclusive em erros, 404 e preflight (S-04).
    this.core.applySecurityHeaders?.(ctx.res);
    try {
      // Healthchecks antes dos middlewares globais: sondas do load balancer não têm credenciais.
      const health = this.framework.health;
      if (health?.handles(ctx.method, ctx.path)) return this.catching(ctx, this.serveHealth(ctx));
      return this.catching(ctx, this.afterHealth(ctx));
    } catch (err) {
      return this.runErrorHandlers(err, ctx);
    }
  }

  /** Liga a parte assíncrona (se houver) ao tratamento de erros. */
  private catching(ctx: Context, step: Step): Step {
    return step ? step.then(undefined, (err: unknown) => this.runErrorHandlers(err, ctx)) : undefined;
  }

  private async serveHealth(ctx: Context): Promise<void> {
    if (await this.framework.health!.serve(ctx, this.server.draining || this.server.closing !== undefined)) return;
    await this.afterHealth(ctx);
  }

  private afterHealth(ctx: Context): Step {
    // O body chega lido aos middlewares globais (invariante 5), sem uma camada de middleware para isso.
    const reading = this.readBody(ctx);
    if (reading) return reading.then(() => this.afterBody(ctx));
    return this.afterBody(ctx);
  }

  private afterBody(ctx: Context): Step {
    const step = this.chain()(ctx);
    if (step) return step.then(() => this.checkRouted(ctx));
    this.checkRouted(ctx);
    return undefined;
  }

  /**
   * Um middleware global que não chama next() e não responde: a rota não roda (antes, rodava mesmo assim).
   * Para a requisição não ficar sem resposta, 404, como no Koa.
   */
  private checkRouted(ctx: Context): void {
    if (!(ctx as unknown as Record<symbol, boolean>)[kRouted] && !ctx.sent) {
      ctx.log.warn({ method: ctx.method, path: ctx.path }, 'a global middleware neither called next() nor sent a response');
      sendProblem(ctx, problem(404, undefined, { code: 'NOT_FOUND' }), this.core.opts.formatError);
    }
  }

  /**
   * Cadeia global (Chain of Responsibility pré-compilada): os middlewares de `app.use()` envolvem o
   * roteamento e a rota, como no Koa. Um `await next()` num middleware global inclui o handler.
   */
  private chain(): (ctx: Context) => Step {
    const mws = this.core.middlewares;
    if (this.globalChain?.size !== mws.length) {
      this.globalChain = { size: mws.length, run: compileChain([...mws], (ctx) => this.route(ctx)) };
    }
    return this.globalChain.run;
  }

  /** Fim da cadeia global: OpenAPI, roteamento, 404/405 e o programa da rota. */
  private route(ctx: Context): Step {
    (ctx as unknown as Record<symbol, boolean>)[kRouted] = true;
    if (ctx.sent) return undefined;
    // Só cria a Promise do OpenAPI se ele estiver configurado (F-41).
    if (this.framework.openapi) {
      return this.framework.serveOpenAPI(ctx).then((served) => (served ? undefined : this.dispatch(ctx)));
    }
    return this.dispatch(ctx);
  }

  /** Roteamento, 404/405 e o programa da rota. */
  private dispatch(ctx: Context): Step {
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
    if (match.route.info) (ctx as unknown as Record<symbol, RouteInfo>)[kRoute] = match.route.info;
    // O programa é montado no commit do registro; o fallback cobre rotas registradas por fora dele.
    const run = (match.route.run ??= buildRouteProgram(match.route, this.core.serializers));
    return run(ctx);
  }

  /**
   * Executa os `onError` do usuário. Se um deles lançar, o erro é logado e seguimos
   * para a resposta padrão com o erro **original** — nunca deixamos a Promise rejeitar (B-08).
   */
  private async runErrorHandlers(err: unknown, ctx: Context): Promise<void> {
    (ctx as unknown as Record<symbol, unknown>)[kError] = err;
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

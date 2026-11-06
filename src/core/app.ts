import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { compileAutoRoutes, compileManualRoute, createGroup, type CompiledRoute, type MountOptions, type RouterRef } from './compiler.ts';
import { MountedGroup } from './mounted-group.ts';
import { compose, type Middleware } from './compose.ts';
import { Context, kBindResponse, kRawSend } from './context.ts';
import '../shims/symbol-metadata.ts';
import { bodyParser } from './body-parser.ts';
import { assertSchemas, validateRequest } from './request-validation.ts';
import { sendError, sendResult, type Serializer } from './response.ts';
import { RouteTable } from './route-table.ts';
import { mediaType } from '../utils/content-type.ts';
import { inject, type InjectOptions, type InjectResponse } from './inject.ts';
import { guardsMiddleware } from './guard.ts';
import { shutdownCoordinator, type ShutdownOptions, type ShutdownTarget } from './shutdown.ts';
import { consoleLogger, silentLogger, type Logger } from './logger.ts';
import { buildSecurityHeaders, type SecurityHeadersOptions, type SecurityPreset } from '../middlewares/security-headers.ts';

export interface ListenOptions {
  /** Padrão: 3000. Use 0 para uma porta livre aleatória. */
  port?: number;
  /** Padrão: `127.0.0.1`. Use `0.0.0.0` para aceitar conexões externas (ex.: em containers). */
  host?: string;
}

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
  /**
   * Headers de segurança aplicados a toda resposta (S-04). Padrão: `'api'`.
   * `'web'` libera recursos do próprio site (CSP `'self'`) para quem serve páginas; `false` desliga.
   */
  securityHeaders?: SecurityHeadersOptions | SecurityPreset | false;
  /**
   * Serializadores por content type, para responder em outros formatos (F-31):
   * `{ 'application/yaml': (data) => YAML.stringify(data) }`. JSON e valores crus já são nativos.
   */
  serializers?: Record<string, Serializer>;
  /** Timeouts do servidor HTTP (S-06). */
  timeouts?: ServerTimeouts;
  /**
   * Modo estrito (S-07): exige schema de `body` em POST/PUT/PATCH e schema de `response`
   * em toda rota, falhando no `app.mount()`. Padrão: `false`.
   */
  requireSchemas?: boolean;
  /** Máximo de pares chave/valor lidos da query string. Padrão: 1000 (S-06). */
  queryMaxKeys?: number;
  /** Logger compatível com pino. Padrão: `consoleLogger()`; `false` desliga (F-06). */
  logger?: Logger | false;
  /** Loga cada requisição concluída (método, path, status, duração) em nível `info`. Padrão: `false`. */
  logRequests?: boolean;
  /** Request id (F-06). */
  requestId?: RequestIdOptions;
  /**
   * Encerramento gracioso nos sinais do processo, ativado pelo `listen()` (F-07).
   * Ligado por padrão (SIGINT/SIGTERM, 10s); `false` desliga.
   */
  shutdown?: ShutdownOptions | false;
  /**
   * Confia nos headers `X-Forwarded-For`, `-Host` e `-Proto` para `ctx.ip`, `ctx.host` e `ctx.protocol`
   * (S-09). Padrão: `false`. Use `true` para confiar em toda a cadeia, ou o número de proxies à frente
   * do app (ex.: `1` para um load balancer). Só ligue atrás de um proxy que reescreve esses headers.
   */
  trustProxy?: boolean | number;
  /**
   * Hosts aceitos (S-09). Requisições com outro `Host` (ou `X-Forwarded-Host` confiável) recebem 400.
   * Protege contra host header injection e DNS rebinding. Padrão: qualquer host válido.
   */
  allowedHosts?: readonly (string | RegExp)[];
}

export interface RequestIdOptions {
  /** Header lido da requisição e devolvido na resposta. Padrão: `x-request-id`. `false` não envia. */
  header?: string | false;
  /**
   * Reaproveita o id recebido no header (útil atrás de um gateway). Padrão: `true`.
   * O valor só é aceito se tiver até 128 caracteres de `[A-Za-z0-9._:-]`, para evitar log injection.
   */
  trustIncoming?: boolean;
  /** Gerador de ids. Padrão: `crypto.randomUUID()`. */
  generate?: () => string;
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Compara o host com a lista: strings casam com o hostname ou com `host:porta`, sem diferenciar maiúsculas. */
function hostAllowed(hostname: string, host: string, allowed: readonly (string | RegExp)[]): boolean {
  const h = hostname.toLowerCase();
  const full = host.toLowerCase();
  return allowed.some((rule) => (typeof rule === 'string' ? rule.toLowerCase() === h || rule.toLowerCase() === full : rule.test(h)));
}

export class SashikoApp {
  private middlewares: Middleware[] = [];
  private router = new RouteTable();
  private errorHandlers: ((err: unknown, ctx: Context) => void | Promise<void>)[] = [];
  private applySecurityHeaders: ((res: http.ServerResponse) => void) | undefined;
  private readonly opts: AppOptions;
  private readonly serializers: ReadonlyMap<string, Serializer>;
  private server: http.Server | undefined;
  /** Respostas em andamento, para o encerramento gracioso não travar em conexões keep-alive. */
  private readonly inflight = new Set<http.ServerResponse>();
  private closing: http.Server | undefined;
  /** Logger do app (F-06). Use para logs fora de uma requisição. */
  readonly log: Logger;

  constructor(opts: AppOptions = {}) {
    this.opts = opts;
    this.serializers = new Map(Object.entries(opts.serializers ?? {}).map(([type, fn]) => [mediaType(type), fn]));
    this.log = opts.logger === false ? silentLogger : (opts.logger ?? consoleLogger());
    const sd = opts.shutdown || {};
    Object.assign(this.shutdownTarget, {
      log: this.log,
      signals: sd.signals ?? ['SIGINT', 'SIGTERM'],
      exitOnShutdown: sd.exit ?? true,
    });
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

  /**
   * Registra uma classe com `@Router` (F-28). Aceita a classe (construtor sem argumentos) ou uma
   * instância pronta (B-10), e opções aplicadas no ponto de composição:
   *
   * ```ts
   * app
   *   .mount(HealthRoutes)
   *   .mount(new UserRoutes(repo), { prefix: '/v2/users', middlewares: [auth], except: (r) => [r.remove] })
   *   .get('/legacy/:id', (r) => r.getUser);      // mapeamento manual (F-30)
   * ```
   */
  mount<T extends object>(ref: new () => T, options?: MountOptions<T>): MountedGroup<T>;
  mount<T extends object>(ref: T extends abstract new (...args: never) => unknown ? never : T, options?: MountOptions<T>): MountedGroup<T>;
  mount(ref: RouterRef, options: MountOptions = {}): MountedGroup<object> {
    const group = createGroup(ref, options);
    for (const route of compileAutoRoutes(group)) this.addRoute(group.name, route);
    return new MountedGroup(this, group, (g, method, path, select, opts) =>
      this.addRoute(g.name, compileManualRoute(g, method, path, select, opts)),
    );
  }

  private addRoute(owner: string, route: CompiledRoute): void {
    if (this.opts.requireSchemas) assertSchemas(owner, route);
    try {
      this.router.on(route.method, route.path, route);
    } catch (err) {
      throw new Error(
        `[sashiko] app.mount(${owner}): ${route.method} ${route.path} is already registered. ` +
        `Use a different "prefix" to mount the same class twice.`,
        { cause: err },
      );
    }
  }



  async handle(ctx: Context): Promise<void> {
    // Antes de tudo, para valer inclusive em erros, 404 e preflight (S-04).
    this.applySecurityHeaders?.(ctx.res);
    try {
      await compose(ctx, this.middlewares);
      if (ctx.sent) return;

      const match = this.router.find(ctx.method, ctx.path);
      if (!match) {
        const allowed = this.router.allowedMethods(ctx.path);
        if (allowed.length > 0) {
          ctx.res.setHeader('Allow', allowed.join(', '));
          // F-08: OPTIONS automático para qualquer path com rotas.
          if (ctx.method === 'OPTIONS') return void ctx.status(204).res.end();
          ctx.res.statusCode = 405;
          return void ctx[kRawSend](JSON.stringify({ error: 'Method Not Allowed', allowed }), 'application/json; charset=utf-8');
        }
        ctx.res.statusCode = 404;
        return void ctx[kRawSend](JSON.stringify({ error: 'Not Found' }), 'application/json; charset=utf-8');
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
        ctx[kBindResponse](route.schemas.response, this.serializers);
        const result = await route.handler(ctx);
        if (!ctx.sent) sendResult(ctx, route.schemas.response, result, this.serializers);
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
    for (const h of this.errorHandlers) {
      try {
        await h(err, ctx);
      } catch (handlerErr) {
        ctx.log.error({ err: handlerErr, method: ctx.method, path: ctx.path }, 'onError handler failed');
        break;
      }
      if (ctx.res.writableEnded) return;
    }
    sendError(ctx, err);
  }

  /**
   * Listener `(req, res)` do app, para usar com qualquer servidor do Node:
   * `https.createServer(opts, app.callback())`, `http2` em modo compat, testes etc. (F-09).
   */
  callback(): (req: http.IncomingMessage, res: http.ServerResponse) => void {
    const rid = this.opts.requestId ?? {};
    const header = rid.header === false ? undefined : (rid.header ?? 'x-request-id').toLowerCase();
    const trust = rid.trustIncoming ?? true;
    const generate = rid.generate ?? (() => randomUUID());

    return (req, res) => {
      const started = performance.now();
      this.inflight.add(res);
      if (this.closing) res.setHeader('Connection', 'close');
      res.once('close', () => {
        this.inflight.delete(res);
        // Durante o close(), cada resposta concluída libera as conexões que ficaram ociosas.
        this.closing?.closeIdleConnections();
      });
      const incoming = header ? req.headers[header] : undefined;
      const id = trust && typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : generate();
      if (header) res.setHeader(header, id);

      // Última barreira (B-08): nada que aconteça numa requisição pode virar unhandledRejection.
      const fail = (err: unknown) => {
        this.log.error({ err, reqId: id, method: req.method, url: req.url }, 'unhandled error while handling request');
        if (!res.headersSent) res.statusCode = 500;
        if (!res.writableEnded) res.end();
      };
      try {
        const ctx = new Context(req, res, { queryMaxKeys: this.opts.queryMaxKeys, id, logger: this.log, trustProxy: this.opts.trustProxy });
        // S-09: Host ausente, malformado ou fora da lista permitida → 400, antes de qualquer middleware.
        if (!ctx.host || (this.opts.allowedHosts && !hostAllowed(ctx.hostname, ctx.host, this.opts.allowedHosts))) {
          this.applySecurityHeaders?.(res);
          res.statusCode = 400;
          ctx[kRawSend](JSON.stringify({ error: 'Invalid Host header' }), 'application/json; charset=utf-8');
          return;
        }
        if (this.opts.logRequests) {
          res.once('finish', () => {
            const ms = Math.round((performance.now() - started) * 100) / 100;
            ctx.log.info({ method: ctx.method, path: ctx.path, status: res.statusCode, ms }, 'request completed');
          });
        }
        this.handle(ctx).catch(fail);
      } catch (err) {
        fail(err);
      }
    };
  }

  /** Sobe o servidor HTTP e resolve quando ele está aceitando conexões (F-09). */
  async listen(options: number | ListenOptions = {}): Promise<http.Server> {
    if (this.server) throw new Error('[sashiko] app is already listening; call app.close() first.');
    const { port = 3000, host = '127.0.0.1' } = typeof options === 'number' ? { port: options } : options;

    const server = http.createServer(this.callback());
    const t = this.opts.timeouts ?? {};
    server.requestTimeout = t.requestTimeout ?? 30_000;
    server.headersTimeout = Math.min(t.headersTimeout ?? 10_000, server.requestTimeout || Infinity);
    server.keepAliveTimeout = t.keepAliveTimeout ?? 5_000;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    if (this.opts.shutdown !== false) shutdownCoordinator.register(this.shutdownTarget);
    return server;
  }

  /** Ponte entre este app e o coordenador de sinais (F-07). */
  private readonly shutdownTarget: ShutdownTarget = {
    log: undefined as unknown as Logger, // definido no construtor
    signals: [],
    exitOnShutdown: true,
    shutdown: async (signal) => {
      const opts = this.opts.shutdown || {};
      try {
        await this.close(opts.timeoutMs ?? 10_000);
        await opts.onShutdown?.(signal);
        return true;
      } catch (err) {
        this.log.error({ err, signal }, 'error during graceful shutdown');
        return false;
      }
    },
  };

  /**
   * Para de aceitar conexões, encerra as ociosas e espera as requisições em andamento terminarem.
   * Depois de `graceMs`, força o fechamento das restantes.
   */
  async close(graceMs = 10_000): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    this.closing = server;
    // Respostas que ainda não enviaram headers avisam o cliente para não reusar a conexão.
    for (const res of this.inflight) if (!res.headersSent) res.setHeader('Connection', 'close');
    const force = setTimeout(() => server.closeAllConnections(), graceMs);
    force.unref();
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeIdleConnections();
      });
    } finally {
      clearTimeout(force);
      this.closing = undefined;
      shutdownCoordinator.unregister(this.shutdownTarget);
    }
  }

  /** Executa uma requisição em memória, sem rede. Ideal para testes (F-09). */
  inject(opts: InjectOptions | string): Promise<InjectResponse> {
    return inject(this.callback(), typeof opts === 'string' ? { url: opts } : opts);
  }

}

export function createApp(opts?: AppOptions): SashikoApp {
  return new SashikoApp(opts);
}

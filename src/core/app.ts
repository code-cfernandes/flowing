import type http from 'node:http';
import type https from 'node:https';
import '../shims/symbol-metadata.ts';
import type { TlsOptions } from '../server/tls.ts';
import {
  childScope,
  joinPrefix,
  compileAutoRoutes,
  compileManualRoute,
  createGroup,
  ROOT_SCOPE,
  type CompiledRoute,
  type GroupOptions,
  type MountOptions,
  type RouteScope,
  type RouterRef,
} from './compiler.ts';
import { MountedGroup, RouteGroupScope } from './mounted-group.ts';
import type { Middleware } from './compose.ts';
import type { Context, OnSendHook } from './context.ts';
import { staticHandler, type StaticOptions } from '../server/static.ts';
import { canonicalPath, joinPaths } from '../utils/path.ts';
import { generateOpenAPI, type OpenAPIOptions } from '../openapi/generate.ts';
import { compileHealth, type HealthOptions } from './health.ts';
import { mediaType } from '../utils/content-type.ts';
import { compileHostMatcher } from '../utils/origin-match.ts';
import { inject, type InjectOptions, type InjectResponse } from './inject.ts';
import { guardsMiddleware } from './guard.ts';
import { consoleLogger, silentLogger, type Logger } from './logger.ts';
import { createTelemetry } from './telemetry.ts';
import { buildSecurityHeaders } from '../middlewares/security-headers.ts';
import type { AppCore } from './app/core.ts';
import type { AppOptions, ListenOptions, OnCloseHook, OnErrorHook, OnRequestHook, OnResponseHook } from './app/options.ts';
import { FrameworkRoutes } from './registry/framework-routes.ts';
import { RouteRegistry } from './registry/registry.ts';
import { RequestHandler } from './runtime/request-handler.ts';
import { RequestObserver } from './runtime/observer.ts';
import { ServerLifecycle } from './runtime/server.ts';
import { routeHooks } from './hooks.ts';

export type {
  AppOptions,
  ListenOptions,
  OnCloseHook,
  OnErrorHook,
  OnRequestHook,
  OnResponseHook,
  RequestIdOptions,
  ResponseInfo,
  ServerTimeouts,
} from './app/options.ts';

function assertOpen(scope: RouteScope): void {
  if (scope.token && !scope.token.open) {
    throw new Error('[sashiko] app.group(): this group has already finished; register its routes inside the callback, synchronously.');
  }
}

const isThenable = (v: unknown): boolean =>
  (typeof v === 'object' || typeof v === 'function') && v !== null && typeof (v as { then?: unknown }).then === 'function';

/**
 * O app. É uma fachada (Facade) sobre o registro de rotas, as rotas do próprio framework (health, OpenAPI),
 * o servidor e o pipeline da requisição: a API pública fica aqui, e o trabalho fica nesses componentes.
 */
export class SashikoApp {
  readonly log: Logger;
  private readonly core: AppCore;
  private readonly registry: RouteRegistry;
  private readonly framework: FrameworkRoutes;
  private readonly runtime: ServerLifecycle;
  private readonly requests: RequestHandler;

  constructor(opts: AppOptions = {}) {
    this.log = opts.logger === false ? silentLogger : (opts.logger ?? consoleLogger());
    this.core = {
      opts,
      log: this.log,
      middlewares: [],
      errorHandlers: [],
      onSendHooks: [],
      onRequestHooks: [],
      telemetry: opts.telemetry ? createTelemetry(opts.telemetry) : undefined,
      onResponseHooks: [],
      scopedOnResponse: 0,
      onCloseHooks: [],
      // Compilados na criação: uma regra inválida falha aqui, e não na primeira requisição.
      allowedHosts: opts.allowedHosts ? compileHostMatcher(opts.allowedHosts) : undefined,
      serializers: new Map(Object.entries(opts.serializers ?? {}).map(([type, fn]) => [mediaType(type), fn])),
      applySecurityHeaders: opts.securityHeaders !== false ? buildSecurityHeaders(opts.securityHeaders) : undefined,
    };
    this.registry = new RouteRegistry(
      this.core,
      () => this.framework.reservedPaths(),
      () => this.framework.openapi?.cache.clear(),
    );
    this.framework = new FrameworkRoutes(this.core, this.registry);
    const observer = new RequestObserver(this.core);
    this.runtime = new ServerLifecycle(this.core, () => this.callback(), observer);
    this.requests = new RequestHandler(this.core, this.registry, this.framework, this.runtime, observer);
  }

  use(mw: Middleware): this {
    this.core.middlewares.push(mw);
    return this;
  }

  onError(h: OnErrorHook): this {
    this.core.errorHandlers.push(h);
    return this;
  }

  /**
   * Roda imediatamente antes de escrever uma resposta com corpo (exceto streams), inclusive em erros
   * e 404. É síncrono: pode alterar headers (ETag, assinatura) ou devolver `{ body, contentType }`
   * novos. Se lançar, o erro é logado e a resposta original é enviada (F-04).
   */
  onSend(hook: OnSendHook): this {
    this.core.onSendHooks.push(hook);
    return this;
  }

  /**
   * Roda no início de cada requisição, antes da validação do `Host` e dos middlewares: abrir um span, contar
   * requisições ativas. Toda requisição que passa por aqui também passa pelo `onResponse`. É síncrono; erros
   * são só logados (F-38).
   */
  onRequest(hook: OnRequestHook): this {
    this.core.onRequestHooks.push(hook);
    return this;
  }

  /**
   * Roda exatamente uma vez quando a requisição termina, com status, duração, `outcome` (`completed`,
   * `aborted`, `error`), motivo do cancelamento, tempo até os headers, rota e se foi stream: métricas,
   * tracing, auditoria. Pode ser assíncrono; erros são só logados (F-04, F-38).
   */
  onResponse(hook: OnResponseHook): this {
    this.core.onResponseHooks.push(hook);
    return this;
  }

  /**
   * Roda no `close()`, depois que o servidor fecha, qualquer que seja a origem (sinal, teste, código),
   * e antes do `shutdown.onShutdown`. Erros são logados e fazem o `close()` rejeitar ao final (F-04).
   */
  onClose(hook: OnCloseHook): this {
    this.core.onCloseHooks.push(hook);
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
    return this.mountIn(ROOT_SCOPE, ref, options);
  }

  /**
   * Agrupa `mount()`s sob um prefixo, middlewares e guards comuns. Não é um container: é só composição,
   * com a mesma semântica do `mount()`. Grupos podem ser aninhados.
   *
   * ```ts
   * app.group({ prefix: '/v2', middlewares: [authenticate], guards: [isAdmin] }, (g) =>
   *   g.mount(UserRoutes).mount(new OrderRoutes(db)),
   * );
   * ```
   * Ordem de execução: middlewares dos grupos (de fora para dentro) → do `mount()` → da classe → do método.
   */
  group(options: GroupOptions, define: (group: RouteGroupScope) => unknown): this {
    this.groupIn(ROOT_SCOPE, options, define);
    return this;
  }

  /** @internal */
  groupIn(parent: RouteScope, options: GroupOptions, define: (group: RouteGroupScope) => unknown): void {
    assertOpen(parent);
    const scope = childScope(parent, options);
    // Registro em duas fases: o que o callback registrar fica pendente e só é efetivado se ele terminar
    // de forma síncrona e sem erro. Grupos aninhados entram no lote do grupo mais externo; se um aninhado
    // falhar (mesmo com o erro capturado pelo externo), só a parte dele é descartada.
    const outermost = this.registry.pending === undefined;
    if (outermost) this.registry.pending = [];
    const mark = this.registry.pending!.length;
    try {
      const result = define(new RouteGroupScope(this, scope));
      if (isThenable(result)) {
        // O callback continua rodando depois do `await`; o escopo fechado abaixo rejeita registros
        // tardios, e este handler evita um unhandledRejection.
        (result as PromiseLike<unknown>).then(undefined, (err: unknown) =>
          this.log.error({ err }, 'async app.group() callback failed after the group was rejected'),
        );
        throw new Error('[sashiko] app.group(): the callback must be synchronous; do async work before registering routes.');
      }
      if (outermost) this.registry.commit(this.registry.pending!);
    } catch (err) {
      this.registry.pending!.length = mark;
      throw err;
    } finally {
      (scope.token as { open: boolean }).open = false;
      if (outermost) this.registry.pending = undefined;
    }
  }

  /**
   * Serve os arquivos de `root` em `GET prefix/*` (F-13). É uma rota como as outras: vale `group()`
   * (host, guards, middlewares), 404/405 e a checagem de conflitos. Não entra no OpenAPI.
   *
   * ```ts
   * app.static('/assets', './public', { maxAge: '7d', immutable: true });
   * app.static('/', './dist', { fallback: 'index.html' }); // SPA
   * ```
   * Caminhos que saem da raiz (`..`, symlinks), arquivos ocultos e diretórios sem índice respondem 404.
   */
  static(prefix: string, root: string, opts: StaticOptions = {}): this {
    this.staticIn(ROOT_SCOPE, prefix, root, opts);
    return this;
  }

  /** @internal */
  staticIn(scope: RouteScope, prefix: string, root: string, opts: StaticOptions): void {
    assertOpen(scope);
    const handler = staticHandler(root, opts);
    const base = joinPrefix(scope.prefix, prefix) || '/';
    const route = (path: string): CompiledRoute => ({
      method: 'GET',
      path,
      handler: (ctx) => handler(ctx),
      schemas: {},
      middlewares: [...scope.middlewares],
      guards: [...scope.guards],
      hooks: routeHooks(scope.hooks),
      owner: 'static',
      handlerName: `static('${prefix}')`,
      hosts: scope.hosts,
      internal: true,
    });
    // `prefix/*` cobre os arquivos; o próprio prefixo (`/assets`, `/assets/`) serve o índice.
    const routes = [route(joinPaths(base, '*'))];
    if (base !== '/') routes.push(route(base));
    this.registry.stage(`static('${prefix}')`, routes);
  }

  /** @internal */
  mountIn(scope: RouteScope, ref: RouterRef, options: MountOptions = {}): MountedGroup<object> {
    assertOpen(scope);
    const group = createGroup(ref, options, scope);
    this.registry.stage(group.name, compileAutoRoutes(group));
    return new MountedGroup(
      this,
      group,
      (g, method, path, select, opts) => {
        assertOpen(scope);
        this.registry.stage(g.name, [compileManualRoute(g, method, path, select, opts)]);
      },
      scope,
    );
  }

  /**
   * Serve o documento OpenAPI 3.1 gerado das rotas (`/openapi.json`) e, com `docs`, o Swagger UI (F-16).
   * As duas rotas passam pelos middlewares globais e pelos `middlewares`/`guards` informados aqui:
   * `app.openapi({ guards: [isAdmin] })`. O documento é gerado na primeira requisição, depois dos `mount()`.
   */
  openapi(opts: OpenAPIOptions = {}): this {
    const path = opts.path ?? '/openapi.json';
    const docs = opts.docs === true ? '/docs' : opts.docs || false;
    if (docs && canonicalPath(docs) === canonicalPath(path))
      throw new Error(`[sashiko] openapi(): "docs" and "path" cannot both be "${path}".`);
    this.framework.assertFreePaths('app.openapi()', docs ? [canonicalPath(path), canonicalPath(docs)] : [canonicalPath(path)], 'openapi');
    const pipeline: Middleware[] = [...(opts.middlewares ?? [])];
    if (opts.guards?.length) pipeline.push(guardsMiddleware(opts.guards));
    this.framework.openapi = { opts, path, docs, pipeline, cache: new Map() };
    return this;
  }

  /**
   * Healthchecks para load balancers e orquestradores (Kubernetes, ECS…).
   * - `GET /livez`: o processo está de pé (200 sempre).
   * - `GET /readyz`: pronto para receber tráfego. Roda os `checks` (banco, fila…) e responde 503 se algum
   *   falhar ou estourar o tempo, e também durante o encerramento.
   *
   * As rotas são servidas **antes** dos middlewares globais (sondas não têm credenciais nem devem
   * consumir rate limit); use `guards`/`middlewares` aqui para restringir.
   */
  health(opts: HealthOptions = {}): this {
    const config = compileHealth(opts, this.log);
    this.framework.assertFreePaths('app.health()', config.paths, 'health');
    this.framework.health = config;
    return this;
  }

  /**
   * Documento OpenAPI 3.1 das rotas registradas até agora, para gravar em arquivo ou testar (F-16).
   * Com virtual hosts, é por host (F-35): `{ host: 'api.exemplo.com' }` traz as rotas desse host e as sem
   * host; sem `host`, só as sem host. Domínios diferentes nunca se misturam num mesmo documento.
   */
  openapiDocument(opts: OpenAPIOptions = this.framework.openapi?.opts ?? {}): Record<string, unknown> {
    return generateOpenAPI(this.registry.routesFor(opts.host?.toLowerCase()), opts, !this.core.opts.formatError);
  }

  /** Executa o pipeline completo para um contexto já criado. */
  handle(ctx: Context): Promise<void> {
    return this.requests.handle(ctx);
  }

  /**
   * Listener `(req, res)` do app, para usar com qualquer servidor do Node:
   * `https.createServer(opts, app.callback())`, `http2` em modo compat, testes etc. (F-09).
   */
  callback(): (req: http.IncomingMessage, res: http.ServerResponse) => void {
    return this.requests.callback();
  }

  /** Sobe o servidor HTTP (ou HTTPS, com `tls`) e resolve quando ele está aceitando conexões (F-09, F-33). */
  listen(options: ListenOptions & { tls: TlsOptions }): Promise<https.Server>;
  listen(options?: number | ListenOptions): Promise<http.Server>;
  listen(options: number | ListenOptions = {}): Promise<http.Server | https.Server> {
    return (this.runtime.listen as (o: number | ListenOptions) => Promise<http.Server | https.Server>)(options);
  }

  /**
   * Troca os certificados sem reiniciar nem derrubar conexões (renovação, ACME externo). Conexões novas
   * usam os novos; as abertas seguem com os antigos. Um certificado inválido lança erro e mantém os atuais.
   */
  reloadTLS(tls: TlsOptions): void {
    this.runtime.reloadTLS(tls);
  }

  /**
   * Para de aceitar conexões, encerra as ociosas e espera as requisições em andamento terminarem.
   * Depois de `graceMs`, força o fechamento das restantes.
   */
  close(graceMs = 10_000): Promise<void> {
    return this.runtime.close(graceMs);
  }

  /** Executa uma requisição em memória, sem rede. Ideal para testes (F-09). */
  inject(opts: InjectOptions | string): Promise<InjectResponse> {
    return inject(this.callback(), typeof opts === 'string' ? { url: opts } : opts);
  }
}

export function createApp(opts?: AppOptions): SashikoApp {
  return new SashikoApp(opts);
}

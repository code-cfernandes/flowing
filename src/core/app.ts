import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { compileTls, type SniTable, type TlsOptions } from '../server/tls.ts';
import { performance } from 'node:perf_hooks';
import {
  childScope,
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
import { RouteGroupScope } from './mounted-group.ts';
import { MountedGroup } from './mounted-group.ts';
import { compose, type Middleware } from './compose.ts';
import { Context, kBindResponse, kRawSend, type OnSendHook } from './context.ts';
import { docsPage, generateOpenAPI, type OpenAPIOptions } from '../openapi/generate.ts';
import { compileHealth, type HealthConfig, type HealthOptions } from './health.ts';
import '../shims/symbol-metadata.ts';
import { bodyParser } from './body-parser.ts';
import type { ProtoPoisoning } from '../utils/safe-json.ts';
import { assertSchemas, validateRequest } from './request-validation.ts';
import { problem, sendError, sendProblem, sendResult, type Serializer } from './response.ts';
import type { ErrorFormatter } from './errors.ts';
import { RouteTable } from './route-table.ts';
import { canonicalPath } from '../utils/path.ts';
import { mediaType } from '../utils/content-type.ts';
import { compileHostMatcher, hostRank, hostReachability, NO_HOST_RANK } from '../utils/origin-match.ts';
import { inject, type InjectOptions, type InjectResponse } from './inject.ts';
import { guardsMiddleware } from './guard.ts';
import { shutdownCoordinator, type ShutdownOptions, type ShutdownTarget } from './shutdown.ts';
import { consoleLogger, silentLogger, type Logger } from './logger.ts';
import { buildSecurityHeaders, type SecurityHeadersOptions, type SecurityPreset } from '../middlewares/security-headers.ts';

/** Depois do envio da resposta (F-04). */
export type OnResponseHook = (ctx: Context, info: { status: number; ms: number }) => void | Promise<void>;
/** No `close()` do app (F-04). */
export type OnCloseHook = () => void | Promise<void>;

export interface ListenOptions {
  /** Padrão: 3000. Use 0 para uma porta livre aleatória. */
  port?: number;
  /** Padrão: `127.0.0.1`. Use `0.0.0.0` para aceitar conexões externas (ex.: em containers). */
  host?: string;
  /**
   * Sobe em HTTPS, com os mesmos timeouts, encerramento gracioso e `close()` do HTTP. Atrás de um
   * proxy que termina o TLS (Caddy, Nginx, load balancer), não use: fique em HTTP com `trustProxy`.
   */
  tls?: TlsOptions;
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
  /**
   * Body JSON com `__proto__` ou `constructor.prototype` (S-08): `'error'` responde 400
   * (`PROTO_POISONING`); `'remove'` descarta as chaves e segue. Padrão: `'error'`.
   */
  protoPoisoning?: ProtoPoisoning;
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
   * - `'api.exemplo.com'` casa com o hostname (qualquer porta); `'api.exemplo.com:8443'` exige a porta;
   * - `'*.exemplo.dev'` aceita só subdomínios;
   * - uma RegExp precisa casar o hostname **inteiro** (como se tivesse `^…$`).
   */
  allowedHosts?: readonly (string | RegExp)[];
  /**
   * Rotas com `host` (virtual hosts) fora do `allowedHosts` nunca são alcançadas (F-35). `'error'` (padrão)
   * falha no registro; `'warn'` só registra um aviso no log; `'off'` não confere.
   */
  unreachableHosts?: 'error' | 'warn' | 'off';
  /**
   * Personaliza o corpo de todos os erros do framework e dos `HttpError` (F-15). Padrão: Problem
   * Details (RFC 9457) em `application/problem+json`. O retorno é enviado como `application/json`.
   */
  formatError?: ErrorFormatter;
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

interface PendingRoute {
  owner: string;
  route: CompiledRoute;
  hosts: (string | undefined)[];
}

/** Registrar num grupo cujo callback já terminou é erro: o registro estaria fora da transação do grupo. */
function assertOpen(scope: RouteScope): void {
  if (scope.token && !scope.token.open) {
    throw new Error('[sashiko] app.group(): this group has already finished; register its routes inside the callback, synchronously.');
  }
}

const isThenable = (v: unknown): boolean =>
  (typeof v === 'object' || typeof v === 'function') && v !== null && typeof (v as { then?: unknown }).then === 'function';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export class SashikoApp {
  private middlewares: Middleware[] = [];
  private router = new RouteTable();
  private errorHandlers: ((err: unknown, ctx: Context) => void | Promise<void>)[] = [];
  private readonly onSendHooks: OnSendHook[] = [];
  private readonly onResponseHooks: OnResponseHook[] = [];
  private readonly onCloseHooks: OnCloseHook[] = [];
  private readonly routes: CompiledRoute[] = [];
  /** Registros pendentes de um `group()` em andamento (duas fases). */
  private pending: PendingRoute[] | undefined;
  private readonly warnedHosts = new Set<string>();
  private draining = false;
  private healthConfig: HealthConfig | undefined;
  private openapiConfig:
    | { opts: OpenAPIOptions; path: string; docs: string | false; pipeline: Middleware[]; cache: Map<string, string> }
    | undefined;
  private closeHooksPending = true;
  private applySecurityHeaders: ((res: http.ServerResponse) => void) | undefined;
  private readonly opts: AppOptions;
  private readonly allowedHosts: ((hostname: string, host: string) => boolean) | undefined;
  private readonly serializers: ReadonlyMap<string, Serializer>;
  private server: http.Server | https.Server | undefined;
  private tlsState: { sni: { current: SniTable } } | undefined;
  /** Respostas em andamento, para o encerramento gracioso não travar em conexões keep-alive. */
  private readonly inflight = new Set<http.ServerResponse>();
  private closing: http.Server | https.Server | undefined;
  /** Logger do app (F-06). Use para logs fora de uma requisição. */
  readonly log: Logger;

  constructor(opts: AppOptions = {}) {
    this.opts = opts;
    // Compilado na criação: uma regra inválida falha aqui, e não na primeira requisição.
    this.allowedHosts = opts.allowedHosts ? compileHostMatcher(opts.allowedHosts) : undefined;
    this.serializers = new Map(Object.entries(opts.serializers ?? {}).map(([type, fn]) => [mediaType(type), fn]));
    this.log = opts.logger === false ? silentLogger : (opts.logger ?? consoleLogger());
    const sd = opts.shutdown || {};
    Object.assign(this.shutdownTarget, {
      log: this.log,
      signals: sd.signals ?? ['SIGINT', 'SIGTERM'],
      exitOnShutdown: sd.exit ?? true,
    });
    if (opts.securityHeaders !== false) this.applySecurityHeaders = buildSecurityHeaders(opts.securityHeaders);
    this.use(bodyParser(opts.bodyLimit ?? 1024 * 1024, opts.protoPoisoning));
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
   * Roda imediatamente antes de escrever uma resposta com corpo (exceto streams), inclusive em erros
   * e 404. É síncrono: pode alterar headers (ETag, assinatura) ou devolver `{ body, contentType }`
   * novos. Se lançar, o erro é logado e a resposta original é enviada (F-04).
   */
  onSend(hook: OnSendHook): this {
    this.onSendHooks.push(hook);
    return this;
  }

  /**
   * Roda depois que a resposta foi enviada (evento `finish`), com o status e a duração: métricas,
   * auditoria. Pode ser assíncrono; erros são só logados (F-04).
   */
  onResponse(hook: OnResponseHook): this {
    this.onResponseHooks.push(hook);
    return this;
  }

  /**
   * Roda no `close()`, depois que o servidor fecha, qualquer que seja a origem (sinal, teste, código),
   * e antes do `shutdown.onShutdown`. Erros são logados e fazem o `close()` rejeitar ao final (F-04).
   */
  onClose(hook: OnCloseHook): this {
    this.onCloseHooks.push(hook);
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
    const outermost = this.pending === undefined;
    if (outermost) this.pending = [];
    const mark = this.pending!.length;
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
      if (outermost) this.commit(this.pending!);
    } catch (err) {
      this.pending!.length = mark;
      throw err;
    } finally {
      (scope.token as { open: boolean }).open = false;
      if (outermost) this.pending = undefined;
    }
  }

  /** @internal */
  mountIn(scope: RouteScope, ref: RouterRef, options: MountOptions = {}): MountedGroup<object> {
    assertOpen(scope);
    const group = createGroup(ref, options, scope);
    this.stage(group.name, compileAutoRoutes(group));
    return new MountedGroup(
      this,
      group,
      (g, method, path, select, opts) => {
        assertOpen(scope);
        this.stage(g.name, [compileManualRoute(g, method, path, select, opts)]);
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
    if (docs === path) throw new Error(`[sashiko] openapi(): "docs" and "path" cannot both be "${path}".`);
    const pipeline: Middleware[] = [...(opts.middlewares ?? [])];
    if (opts.guards?.length) pipeline.push(guardsMiddleware(opts.guards));
    this.openapiConfig = { opts, path, docs, pipeline, cache: new Map() };
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
    this.healthConfig = compileHealth(opts, this.log);
    return this;
  }

  /**
   * Documento OpenAPI 3.1 das rotas registradas até agora, para gravar em arquivo ou testar (F-16).
   * Com virtual hosts, é por host (F-35): `{ host: 'api.exemplo.com' }` traz as rotas desse host e as sem
   * host; sem `host`, só as sem host. Domínios diferentes nunca se misturam num mesmo documento.
   */
  openapiDocument(opts: OpenAPIOptions = this.openapiConfig?.opts ?? {}): Record<string, unknown> {
    return generateOpenAPI(this.routesFor(opts.host?.toLowerCase()), opts, !this.opts.formatError);
  }

  /**
   * Rotas que o roteador **executaria** num host (F-35): para cada método e path, só a vencedora pela mesma
   * prioridade do roteador (exato → curinga mais específico → RegExp → sem host). Assim o OpenAPI documenta
   * exatamente o handler que responde. Sem `hostname`, só as rotas sem host.
   */
  private routesFor(hostname: string | undefined): CompiledRoute[] {
    const best = new Map<string, { route: CompiledRoute; rank: number }>();
    for (const [seq, route] of this.routes.entries()) {
      let rank = route.hosts.length === 0 ? NO_HOST_RANK : -1;
      if (rank === -1 && hostname !== undefined) {
        for (const h of route.hosts) {
          if (!h.test(hostname)) continue;
          // Desempate pela ordem de registro, a mesma que o roteador usa em cada path.
          const r = hostRank(h, seq);
          if (rank === -1 || r < rank) rank = r;
        }
      }
      if (rank === -1) continue;
      const key = `${route.method} ${canonicalPath(route.path)}`;
      const current = best.get(key);
      if (!current || rank < current.rank) best.set(key, { route, rank });
    }
    return this.routes.filter((r) => best.get(`${r.method} ${canonicalPath(r.path)}`)?.route === r);
  }

  /** Se a requisição é para `/openapi.json` ou `/docs` (quando ligados), responde e devolve `true`. */
  private async serveOpenAPI(ctx: Context): Promise<boolean> {
    const cfg = this.openapiConfig;
    if (!cfg || (ctx.method !== 'GET' && ctx.method !== 'HEAD')) return false;
    const isSpec = ctx.path === cfg.path;
    if (!isSpec && !(cfg.docs && ctx.path === cfg.docs)) return false;

    await compose(ctx, [
      ...cfg.pipeline,
      () => {
        if (isSpec) {
          // Um documento por conjunto de rotas visíveis no host da requisição (F-35); a chave não usa o
          // hostname em si, então hosts arbitrários não fazem o cache crescer.
          const visible = this.routesFor(ctx.hostname.toLowerCase());
          const key = visible.map((r) => this.routes.indexOf(r)).join(',');
          let doc = cfg.cache.get(key);
          if (doc === undefined) {
            doc = JSON.stringify(generateOpenAPI(visible, cfg.opts, !this.opts.formatError));
            cfg.cache.set(key, doc);
          }
          ctx[kRawSend](doc, 'application/json; charset=utf-8');
          return;
        }
        const nonce = randomBytes(16).toString('base64');
        const { html, csp } = docsPage(cfg.path, cfg.opts.info?.title ?? 'API', nonce);
        ctx.res.setHeader('Content-Security-Policy', csp);
        ctx.res.setHeader('Cache-Control', 'no-store');
        ctx[kRawSend](html, 'text/html; charset=utf-8');
      },
    ]);
    return true;
  }

  /**
   * Primeira fase: valida as rotas (schemas obrigatórios, hosts alcançáveis, conflitos com o roteador e
   * dentro do próprio lote). Dentro de um `group()`, acumula; fora, efetiva na hora.
   */
  private stage(owner: string, routes: readonly CompiledRoute[]): void {
    const batch = this.pending ?? [];
    for (const route of routes) {
      if (this.opts.requireSchemas) assertSchemas(owner, route);
      this.checkReachableHosts(owner, route);
      for (const host of route.hosts.length > 0 ? route.hosts.map((h) => h.key) : [undefined]) {
        const taken =
          this.router.has(route.method, route.path, host) ||
          batch.some(
            (p) => p.route.method === route.method && canonicalPath(p.route.path) === canonicalPath(route.path) && p.hosts.includes(host),
          );
        if (taken) {
          const where = host ? ` on host ${host}` : '';
          throw new Error(
            `[sashiko] app.mount(${owner}): ${route.method} ${route.path}${where} is already registered. ` +
              `Use a different "prefix" or "host" to mount the same class twice.`,
          );
        }
      }
      batch.push({ owner, route, hosts: route.hosts.length > 0 ? route.hosts.map((h) => h.key) : [undefined] });
    }
    if (this.pending === undefined) this.commit(batch);
  }

  /**
   * Segunda fase: registra o lote no roteador. Se algo ainda falhar (um conflito que o `has()` não prevê),
   * desfaz o que já entrou, e nenhuma rota do lote fica registrada.
   */
  private commit(batch: readonly PendingRoute[]): void {
    const done: { method: string; path: string; host: string | undefined }[] = [];
    try {
      for (const { owner, route, hosts } of batch) {
        for (const host of hosts) {
          try {
            this.router.on(route.method, route.path, route, host);
          } catch (err) {
            throw new Error(`[sashiko] app.mount(${owner}): ${route.method} ${route.path} conflicts with a registered route.`, {
              cause: err,
            });
          }
          done.push({ method: route.method, path: route.path, host });
        }
      }
    } catch (err) {
      for (const r of done.reverse()) this.router.off(r.method, r.path, r.host);
      throw err;
    }
    for (const { route } of batch) this.routes.push(route);
    if (this.openapiConfig && batch.length > 0) this.openapiConfig.cache.clear();
  }

  /**
   * Um host de rota sem interseção com o `allowedHosts` nunca seria alcançado: o app responde 400 antes do
   * roteamento (F-35). Comprovado: erro (ou aviso, com `unreachableHosts: 'warn'`). Sem como provar
   * (RegExp em algum dos lados): aviso.
   */
  private checkReachableHosts(owner: string, route: CompiledRoute): void {
    const mode = this.opts.unreachableHosts ?? 'error';
    const allowed = this.opts.allowedHosts;
    if (mode === 'off' || !allowed) return;
    for (const host of route.hosts) {
      const verdict = hostReachability(host, allowed);
      if (verdict === 'yes') continue;
      const where = `app.mount(${owner}): ${route.method} ${route.path} uses host ${host.label}`;
      if (verdict === 'no' && mode === 'error') {
        throw new Error(
          `[sashiko] ${where}, which no allowedHosts rule accepts; the route is unreachable. Add it to allowedHosts, or set unreachableHosts: 'warn'.`,
        );
      }
      const key = `${owner} ${host.key}`;
      if (this.warnedHosts.has(key)) continue;
      this.warnedHosts.add(key);
      this.log.warn(
        { host: host.label },
        verdict === 'no'
          ? `[sashiko] ${where}, which no allowedHosts rule accepts; the route is unreachable.`
          : `[sashiko] ${where}; could not verify it against allowedHosts (RegExp).`,
      );
    }
  }

  async handle(ctx: Context): Promise<void> {
    // Antes de tudo, para valer inclusive em erros, 404 e preflight (S-04).
    this.applySecurityHeaders?.(ctx.res);
    try {
      // Healthchecks antes dos middlewares globais: sondas do load balancer não têm credenciais.
      if (this.healthConfig && (await this.healthConfig.serve(ctx, this.draining || this.closing !== undefined))) return;
      await compose(ctx, this.middlewares);
      if (ctx.sent || (await this.serveOpenAPI(ctx))) return;

      // F-35: hosts não diferenciam maiúsculas; as regras já são compiladas em minúsculas.
      const hostname = ctx.hostname.toLowerCase();
      const match = this.router.find(ctx.method, ctx.path, hostname);
      if (!match) {
        const allowed = this.router.allowedMethods(ctx.path, hostname);
        if (allowed.length > 0) {
          ctx.res.setHeader('Allow', allowed.join(', '));
          // F-08: OPTIONS automático para qualquer path com rotas.
          if (ctx.method === 'OPTIONS') return void ctx.status(204).res.end();
          return void sendProblem(
            ctx,
            problem(405, undefined, { code: 'METHOD_NOT_ALLOWED', details: { allowed } }),
            this.opts.formatError,
          );
        }
        return void sendProblem(ctx, problem(404, undefined, { code: 'NOT_FOUND' }), this.opts.formatError);
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
    sendError(ctx, err, this.opts.formatError);
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
        const ctx = new Context(req, res, {
          queryMaxKeys: this.opts.queryMaxKeys,
          id,
          logger: this.log,
          trustProxy: this.opts.trustProxy,
          onSend: this.onSendHooks,
        });
        // S-09: Host ausente, malformado ou fora da lista permitida → 400, antes de qualquer middleware.
        if (!ctx.host || (this.allowedHosts && !this.allowedHosts(ctx.hostname, ctx.host))) {
          this.applySecurityHeaders?.(res);
          sendProblem(ctx, problem(400, 'Invalid Host header', { code: 'INVALID_HOST' }), this.opts.formatError);
          return;
        }
        if (this.opts.logRequests || this.onResponseHooks.length > 0) {
          res.once('finish', () => {
            const ms = Math.round((performance.now() - started) * 100) / 100;
            if (this.opts.logRequests) {
              ctx.log.info({ method: ctx.method, path: ctx.path, status: res.statusCode, ms }, 'request completed');
            }
            for (const hook of this.onResponseHooks) {
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

  /** Sobe o servidor HTTP e resolve quando ele está aceitando conexões (F-09). */
  async listen(options: ListenOptions & { tls: TlsOptions }): Promise<https.Server>;
  async listen(options?: number | ListenOptions): Promise<http.Server>;
  async listen(options: number | ListenOptions = {}): Promise<http.Server | https.Server> {
    if (this.server) throw new Error('[sashiko] app is already listening; call app.close() first.');
    const { port = 3000, host = '127.0.0.1', tls } = typeof options === 'number' ? { port: options } : options;

    let server: http.Server | https.Server;
    if (tls) {
      const sni = { current: { find: () => undefined } as SniTable };
      const compiled = compileTls(tls, sni);
      server = https.createServer(compiled.options, this.callback());
      this.tlsState = { sni };
    } else {
      server = http.createServer(this.callback());
      this.tlsState = undefined;
    }
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
    this.closeHooksPending = true;
    this.draining = false;
    if (this.opts.shutdown !== false) shutdownCoordinator.register(this.shutdownTarget);
    return server;
  }

  /**
   * Troca os certificados sem reiniciar nem derrubar conexões (renovação, ACME externo). Conexões novas
   * usam os novos; as abertas seguem com os antigos. Um certificado inválido lança erro e mantém os atuais.
   */
  reloadTLS(tls: TlsOptions): void {
    const server = this.server;
    if (!server || !this.tlsState || !(server instanceof https.Server)) {
      throw new Error('[sashiko] reloadTLS(): the app is not listening with { tls }.');
    }
    const next = { current: this.tlsState.sni.current };
    const compiled = compileTls(tls, next); // valida tudo antes de trocar
    if (compiled.main) server.setSecureContext(compiled.main);
    this.tlsState.sni.current = next.current;
  }

  /** Ponte entre este app e o coordenador de sinais (F-07). */
  private readonly shutdownTarget: ShutdownTarget = {
    log: undefined as unknown as Logger, // definido no construtor
    signals: [],
    exitOnShutdown: true,
    shutdown: async (signal) => {
      const opts = this.opts.shutdown || {};
      try {
        this.draining = true;
        if (opts.drainDelayMs) {
          this.log.info({ signal, drainDelayMs: opts.drainDelayMs }, 'draining before shutdown');
          await new Promise((r) => setTimeout(r, opts.drainDelayMs));
        }
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
    if (!server) return this.runCloseHooks();
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
    await this.runCloseHooks();
  }

  /** `onClose` uma vez por ciclo (até o próximo `listen`); todos rodam mesmo se algum falhar (F-04). */
  private async runCloseHooks(): Promise<void> {
    if (!this.closeHooksPending) return;
    this.closeHooksPending = false;
    const errors: unknown[] = [];
    for (const hook of this.onCloseHooks) {
      try {
        await hook();
      } catch (err) {
        errors.push(err);
        this.log.error({ err }, 'onClose hook failed');
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, `[sashiko] ${errors.length} onClose hook(s) failed`);
  }

  /** Executa uma requisição em memória, sem rede. Ideal para testes (F-09). */
  inject(opts: InjectOptions | string): Promise<InjectResponse> {
    return inject(this.callback(), typeof opts === 'string' ? { url: opts } : opts);
  }
}

export function createApp(opts?: AppOptions): SashikoApp {
  return new SashikoApp(opts);
}

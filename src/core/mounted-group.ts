import type http from 'node:http';
import type https from 'node:https';
import type { TlsOptions } from '../server/tls.ts';
import type { SashikoApp } from './app.ts';
import {
  ROOT_SCOPE,
  type GroupOptions,
  type ManualRouteOptions,
  type MethodSelector,
  type MountOptions,
  type RouteGroup,
  type RouteScope,
} from './compiler.ts';
import type { InjectOptions, InjectResponse } from './inject.ts';
import type { ListenOptions } from './app.ts';
import type { Logger } from './logger.ts';
import type { Middleware } from './compose.ts';
import type { Context, OnSendHook } from './context.ts';
import type { OnCloseHook, OnResponseHook } from './app.ts';
import type { OpenAPIOptions } from '../openapi/generate.ts';
import type { HealthOptions } from './health.ts';

/**
 * Retorno de `app.mount()` (F-30): permite mapear manualmente métodos do grupo e continuar
 * encadeando chamadas do app.
 *
 * ```ts
 * app
 *   .mount(new UserRoutes(repo))
 *   .get('/legacy/:id', (r) => r.getUser, { guards: [isAdmin] })
 *   .mount(HealthRoutes);
 * ```
 */
export class MountedGroup<T extends object> {
  readonly app: SashikoApp;
  readonly #group: RouteGroup;
  readonly #register: (group: RouteGroup, method: string, path: string, select: MethodSelector<object>, opts?: ManualRouteOptions) => void;

  /** @internal Criado por `app.mount()`. */
  constructor(
    app: SashikoApp,
    group: RouteGroup,
    register: (group: RouteGroup, method: string, path: string, select: MethodSelector<object>, opts?: ManualRouteOptions) => void,
    scope: RouteScope = ROOT_SCOPE,
  ) {
    this.app = app;
    this.#group = group;
    this.#register = register;
    this.#scope = scope;
  }

  readonly #scope: RouteScope;

  #map(method: string, path: string, select: MethodSelector<T>, opts?: ManualRouteOptions): this {
    this.#register(this.#group, method, path, select as MethodSelector<object>, opts);
    return this;
  }

  /** Mapeia `GET path` (relativo ao prefixo do grupo) para o método selecionado. */
  get(path: string, select: MethodSelector<T>, opts?: ManualRouteOptions): this {
    return this.#map('GET', path, select, opts);
  }
  post(path: string, select: MethodSelector<T>, opts?: ManualRouteOptions): this {
    return this.#map('POST', path, select, opts);
  }
  put(path: string, select: MethodSelector<T>, opts?: ManualRouteOptions): this {
    return this.#map('PUT', path, select, opts);
  }
  patch(path: string, select: MethodSelector<T>, opts?: ManualRouteOptions): this {
    return this.#map('PATCH', path, select, opts);
  }
  delete(path: string, select: MethodSelector<T>, opts?: ManualRouteOptions): this {
    return this.#map('DELETE', path, select, opts);
  }

  // ---------- Encadeamento com o app ----------
  mount<U extends object>(ref: new () => U, options?: MountOptions<U>): MountedGroup<U>;
  mount<U extends object>(ref: U extends abstract new (...args: never) => unknown ? never : U, options?: MountOptions<U>): MountedGroup<U>;
  mount(ref: object, options?: MountOptions<object>): MountedGroup<object> {
    // Dentro de um `group()`, o próximo `mount()` continua no mesmo grupo.
    return this.app.mountIn(this.#scope, ref, options);
  }
  /** Grupo aninhado no grupo atual (ou no app, fora de um grupo). */
  group(options: GroupOptions, define: (group: RouteGroupScope) => unknown): this {
    this.app.groupIn(this.#scope, options, define);
    return this;
  }
  use(mw: Middleware): SashikoApp {
    return this.app.use(mw);
  }
  openapi(opts?: OpenAPIOptions): SashikoApp {
    return this.app.openapi(opts);
  }
  health(opts?: HealthOptions): SashikoApp {
    return this.app.health(opts);
  }
  openapiDocument(opts?: OpenAPIOptions): Record<string, unknown> {
    return this.app.openapiDocument(opts);
  }
  onError(h: (err: unknown, ctx: Context) => void | Promise<void>): SashikoApp {
    return this.app.onError(h);
  }
  onSend(hook: OnSendHook): SashikoApp {
    return this.app.onSend(hook);
  }
  onResponse(hook: OnResponseHook): SashikoApp {
    return this.app.onResponse(hook);
  }
  onClose(hook: OnCloseHook): SashikoApp {
    return this.app.onClose(hook);
  }
  listen(options: ListenOptions & { tls: TlsOptions }): Promise<https.Server>;
  listen(options?: number | ListenOptions): Promise<http.Server>;
  listen(options?: number | ListenOptions): Promise<http.Server | https.Server> {
    return (this.app.listen as (o?: number | ListenOptions) => Promise<http.Server | https.Server>)(options);
  }
  reloadTLS(tls: TlsOptions): void {
    this.app.reloadTLS(tls);
  }
  close(graceMs?: number): Promise<void> {
    return this.app.close(graceMs);
  }
  callback(): (req: http.IncomingMessage, res: http.ServerResponse) => void {
    return this.app.callback();
  }
  inject(opts: InjectOptions | string): Promise<InjectResponse> {
    return this.app.inject(opts);
  }
  get log(): Logger {
    return this.app.log;
  }
}

/**
 * O `g` de `app.group(opts, (g) => …)`: só registra rotas, todas com o prefixo, os middlewares e os guards
 * do grupo. Middlewares globais e hooks continuam no app (`app.use()`, `app.onError()`…).
 */
export class RouteGroupScope {
  readonly #app: SashikoApp;
  readonly #scope: RouteScope;

  /** @internal Criado por `app.group()`. */
  constructor(app: SashikoApp, scope: RouteScope) {
    this.#app = app;
    this.#scope = scope;
  }

  mount<U extends object>(ref: new () => U, options?: MountOptions<U>): MountedGroup<U>;
  mount<U extends object>(ref: U extends abstract new (...args: never) => unknown ? never : U, options?: MountOptions<U>): MountedGroup<U>;
  mount(ref: object, options?: MountOptions<object>): MountedGroup<object> {
    return this.#app.mountIn(this.#scope, ref, options);
  }

  /** Grupo aninhado: prefixos se somam, middlewares e guards se acumulam de fora para dentro. */
  group(options: GroupOptions, define: (group: RouteGroupScope) => unknown): this {
    this.#app.groupIn(this.#scope, options, define);
    return this;
  }
}

import type { Context } from './context.ts';
import type { Guard } from './guard.ts';
import type { Middleware } from './compose.ts';
import { readOwnMetadata, type MethodMetadata, type RouterMetadata } from './metadata.ts';
import type { RouteDefinition } from './route-table.ts';
import { joinPaths, pathParams } from '../utils/path.ts';
import { compileRouteHost, type MatchRule, type RouteHostRule } from '../utils/origin-match.ts';

export interface CompiledRoute extends RouteDefinition {
  method: string;
  path: string;
  /** Classe e método de origem, para mensagens e para o OpenAPI (F-16). */
  owner: string;
  handlerName: string;
  /** Virtual hosts da rota (F-35); vazio = qualquer host. */
  hosts: readonly RouteHostRule[];
}

/** Um host, ou uma lista: `'api.exemplo.com'`, `'*.exemplo.dev'`, `/^tenant-\d+\.exemplo\.com$/`. */
export type HostOption = MatchRule | readonly MatchRule[];

export function compileHostOption(host: HostOption | undefined): RouteHostRule[] {
  if (host === undefined) return [];
  const list = Array.isArray(host) ? host : [host as MatchRule];
  if (list.length === 0) throw new Error('[sashiko] host: the list cannot be empty.');
  return list.map(compileRouteHost);
}

/** Classe com construtor sem argumentos **ou** instância já construída (B-10). */
export type RouterRef = (new () => object) | object;

type AnyMethod = (...args: never[]) => unknown;

/** Seleciona um método da instância montada: `(r) => r.getUser` (F-30). */
export type MethodSelector<T> = (routes: T) => AnyMethod;
/** Seleciona vários métodos: `(r) => [r.list, r.getUser]` (F-30). */
export type MethodsSelector<T> = (routes: T) => readonly AnyMethod[];

/** Opções de `app.mount()`, aplicadas no ponto de composição (F-28, F-30). */
export interface MountOptions<T = object> {
  /** Substitui o prefixo definido no `@Router`. */
  prefix?: string;
  /** Registra só estes métodos de rota. Não pode ser usado junto com `except`. */
  only?: MethodsSelector<T>;
  /** Registra todos os métodos de rota, exceto estes. */
  except?: MethodsSelector<T>;
  /** Registra as rotas declaradas na classe. Padrão: `true`. Use `false` para só mapear manualmente. */
  auto?: boolean;
  /** Middlewares para todas as rotas do grupo; rodam antes dos `@Middlewares` da classe. */
  middlewares?: readonly Middleware[];
  /** Guards para todas as rotas do grupo; rodam antes dos `@Guards` da classe. */
  guards?: readonly Guard[];
  /** Virtual host (F-35): as rotas só respondem nesses hosts. Sem `host`, valem para qualquer um. */
  host?: HostOption;
}

/** Opções de uma rota mapeada manualmente: `.get(path, sel, { middlewares, guards })` (F-30). */
export interface ManualRouteOptions {
  /** Rodam depois dos `@Middlewares` do método (são as mais específicas). */
  middlewares?: readonly Middleware[];
  /** Rodam depois dos `@Guards` do método. */
  guards?: readonly Guard[];
}

/** Opções de `app.group()`: valem para todos os `mount()` do grupo, inclusive de grupos aninhados. */
export interface GroupOptions {
  /** Somado antes do prefixo de cada classe: `group({ prefix: '/v2' })` + `@Router('/users')` → `/v2/users`. */
  prefix?: string;
  /** Rodam antes dos middlewares do `mount()`. */
  middlewares?: readonly Middleware[];
  /** Rodam antes dos guards do `mount()`. */
  guards?: readonly Guard[];
  /** Virtual host (F-35) para todos os `mount()` do grupo, inclusive os aninhados. */
  host?: HostOption;
}

/** Escopo acumulado dos grupos em volta de um `mount()`. */
export interface RouteScope {
  /** Validade do grupo: depois que o callback do `group()` termina, registrar nele é erro. */
  readonly token?: { open: boolean };
  prefix: string;
  middlewares: readonly Middleware[];
  guards: readonly Guard[];
  hosts: readonly RouteHostRule[];
}

export const ROOT_SCOPE: RouteScope = { prefix: '', middlewares: [], guards: [], hosts: [] };

/** Host herdado do grupo ou definido aqui; os dois ao mesmo tempo seria ambíguo (F-35). */
function scopedHosts(where: string, inherited: readonly RouteHostRule[], own: HostOption | undefined): readonly RouteHostRule[] {
  if (own === undefined) return inherited;
  if (inherited.length > 0) {
    throw new Error(
      `[sashiko] ${where}: "host" is already set by an outer group (${inherited.map((h) => h.label).join(', ')}); ` +
        'set it in only one place.',
    );
  }
  return compileHostOption(own);
}

/** Prefixo de um grupo dentro de outro, sem barras duplicadas; vazio não altera nada. */
export function joinPrefix(outer: string, inner: string): string {
  if (!outer) return inner;
  if (!inner) return outer;
  return joinPaths(outer, inner);
}

/** Escopo de um grupo aninhado em `parent`. */
export function childScope(parent: RouteScope, opts: GroupOptions): RouteScope {
  return {
    token: { open: true },
    hosts: scopedHosts('app.group()', parent.hosts, opts.host),
    prefix: joinPrefix(parent.prefix, opts.prefix ?? ''),
    middlewares: [...parent.middlewares, ...(opts.middlewares ?? [])],
    guards: [...parent.guards, ...(opts.guards ?? [])],
  };
}

/** Um grupo montado: a instância, sua metadata e as opções do `mount`. */
export interface RouteGroup {
  name: string;
  instance: object;
  meta: RouterMetadata;
  prefix: string;
  options: MountOptions;
  scope: RouteScope;
  hosts: readonly RouteHostRule[];
}

export function createGroup(ref: RouterRef, options: MountOptions = {}, scope: RouteScope = ROOT_SCOPE): RouteGroup {
  const isClass = typeof ref === 'function';
  const Class = (isClass ? ref : ref.constructor) as new () => object;
  const meta = readOwnMetadata(Class);
  if (!meta?.isRouter) {
    throw new Error(
      `[sashiko] Class ${Class.name} is not decorated with @Router('/prefix'). ` + `Add it to register the class with app.mount().`,
    );
  }
  if (options.only && options.except) {
    throw new Error(`[sashiko] app.mount(${Class.name}): use either "only" or "except", not both.`);
  }
  // Instâncias permitem injetar dependências pelo construtor: app.mount(new UserRoutes(repo))
  const instance = isClass ? new Class() : ref;
  const hosts = scopedHosts(`app.mount(${Class.name})`, scope.hosts, options.host);
  return { name: Class.name, instance, meta, prefix: joinPrefix(scope.prefix, options.prefix ?? meta.prefix), options, scope, hosts };
}

/** Rotas declaradas na classe (`@Get`, `@Post`…), filtradas por `only`/`except` e `auto`. */
export function compileAutoRoutes(group: RouteGroup): CompiledRoute[] {
  const { meta, options } = group;
  if (options.auto === false) return [];

  const declared = [...meta.methods].filter(([, m]) => m.method && m.path).map(([name]) => name);
  const pick = (selector: MethodsSelector<object>, label: string) =>
    new Set(selector(group.instance).map((fn) => resolveMethod(group, fn, label, declared)));

  const excluded = options.except ? pick(options.except, 'except') : new Set<string | symbol>();
  const selected = options.only ? pick(options.only, 'only') : new Set(declared.filter((n) => !excluded.has(n)));

  return declared
    .filter((name) => selected.has(name))
    .map((name) => {
      const m = meta.methods.get(name)!;
      return buildRoute(group, name, m, m.method!, m.path!);
    });
}

/** Rota mapeada no app: `.get('/legacy/:id', (r) => r.getUser, opts)` (F-30). */
export function compileManualRoute(
  group: RouteGroup,
  httpMethod: string,
  path: string,
  selector: MethodSelector<object>,
  options: ManualRouteOptions = {},
): CompiledRoute {
  const name = resolveMethod(group, selector(group.instance), `.${httpMethod.toLowerCase()}('${path}')`);
  return buildRoute(group, name, group.meta.methods.get(name)!, httpMethod, path, options);
}

function buildRoute(
  group: RouteGroup,
  name: string | symbol,
  methodMeta: MethodMetadata,
  httpMethod: string,
  path: string,
  manual: ManualRouteOptions = {},
): CompiledRoute {
  const fn = (group.instance as Record<string | symbol, unknown>)[name] as (ctx: Context) => unknown;
  const { meta, options, instance, scope } = group;
  const fullPath = joinPaths(group.prefix, path);
  checkPath(`${group.name}.${String(name)}`, httpMethod, fullPath, methodMeta.schemas.params);
  return {
    method: httpMethod,
    path: fullPath,
    owner: group.name,
    handlerName: String(name),
    hosts: group.hosts,
    handler: (ctx: Context) => fn.call(instance, ctx),
    schemas: methodMeta.schemas,
    // Ordem: grupos → mount → classe → método → rota manual (F-01, F-28, F-30)
    middlewares: [
      ...scope.middlewares,
      ...(options.middlewares ?? []),
      ...meta.middlewares,
      ...methodMeta.middlewares,
      ...(manual.middlewares ?? []),
    ],
    guards: [...scope.guards, ...(options.guards ?? []), ...meta.guards, ...methodMeta.guards, ...(manual.guards ?? [])],
  };
}

/**
 * Descobre o nome do método a partir da função devolvida pelo seletor.
 * Só aceita métodos com algum decorator do Sashiko (a "permissão" no nível do método).
 */
function resolveMethod(
  group: RouteGroup,
  fn: unknown,
  where: string,
  allowed: readonly (string | symbol)[] = [...group.meta.methods.keys()],
): string | symbol {
  const target = group.instance as Record<string | symbol, unknown>;
  const name = typeof fn === 'function' ? allowed.find((n) => target[n] === fn) : undefined;
  if (name !== undefined) return name;

  const label = typeof fn === 'function' && fn.name ? `"${fn.name}"` : 'the selected value';
  const available = allowed.map(String).join(', ') || '(none)';
  const decorated = typeof fn === 'function' && [...group.meta.methods.keys()].some((n) => target[n] === fn);
  const isMethod =
    typeof fn === 'function' && Object.values(Object.getOwnPropertyDescriptors(Object.getPrototypeOf(target))).some((d) => d.value === fn);
  const reason = decorated
    ? `${label} has no HTTP verb decorator, so it is not an automatic route; map it manually with .get()/.post()…`
    : isMethod
      ? `${label} has no Sashiko decorator (@Get, @Schema, @Middlewares, @Guards…), so it cannot be exposed`
      : `${label} is not a method of ${group.name}`;
  const at = where.startsWith('.') ? where : ` ${where}`;
  throw new Error(`[sashiko] app.mount(${group.name})${at}: ${reason}. Available: ${available}.`);
}

/**
 * Valida o path no registro e confere as chaves do schema de `params` contra os parâmetros do path,
 * já com o prefixo do `@Router`/`mount` (F-29). Schemas sem `properties` (não JSON Schema) não são conferidos.
 */
function checkPath(where: string, method: string, path: string, params: object | undefined): void {
  let names: string[];
  try {
    names = pathParams(path);
  } catch (err) {
    throw new Error(`[sashiko] ${where} (${method} ${path}): ${(err as Error).message}.`);
  }
  const props = (params as { properties?: unknown } | undefined)?.properties;
  if (!props || typeof props !== 'object') return;
  const keys = Object.keys(props);
  const missing = names.filter((n) => !keys.includes(n));
  const extra = keys.filter((k) => !names.includes(k));
  if (missing.length === 0 && extra.length === 0) return;
  const parts = [
    missing.length ? `missing in params schema: ${missing.map((n) => `"${n}"`).join(', ')}` : '',
    extra.length ? `not in path: ${extra.map((n) => `"${n}"`).join(', ')}` : '',
  ].filter(Boolean);
  throw new Error(`[sashiko] ${where} (${method} ${path}): params schema does not match the path; ${parts.join('; ')}.`);
}

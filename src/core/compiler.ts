import type { Context } from './context.ts';
import type { Guard } from './guard.ts';
import type { Middleware } from './compose.ts';
import { readOwnMetadata } from './metadata.ts';
import type { RouteDefinition } from './route-table.ts';
import { joinPaths } from '../utils/path.ts';

export interface CompiledRoute extends RouteDefinition {
  method: string;
  path: string;
}

/** Classe com construtor sem argumentos **ou** instância já construída (B-10). */
export type RouterRef = (new () => object) | object;

/** Nomes dos métodos de uma instância (para `only`/`except`). */
export type MethodNames<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never }[keyof T] & string;

/** Opções de `app.mount()`, aplicadas no ponto de composição (F-28). */
export interface MountOptions<T = object> {
  /** Substitui o prefixo definido no `@Router`. */
  prefix?: string;
  /** Registra só estes métodos de rota. Não pode ser usado junto com `except`. */
  only?: readonly MethodNames<T>[];
  /** Registra todos os métodos de rota, exceto estes. */
  except?: readonly MethodNames<T>[];
  /** Middlewares para todas as rotas registradas; rodam antes dos `@Use` da classe. */
  middlewares?: readonly Middleware[];
  /** Guards para todas as rotas registradas; rodam antes dos `@UseGuards` da classe. */
  guards?: readonly Guard[];
}

export function compileRoutes(ref: RouterRef, opts: MountOptions = {}): CompiledRoute[] {
  const isClass = typeof ref === 'function';
  const Class = (isClass ? ref : ref.constructor) as new () => object;
  const meta = readOwnMetadata(Class);
  if (!meta?.isRouter) {
    throw new Error(
      `[sashiko] Class ${Class.name} is not decorated with @Router('/prefix'). ` +
      `Add it to register the class with app.mount().`,
    );
  }

  const routeNames = [...meta.methods].filter(([, m]) => m.method && m.path).map(([name]) => String(name));
  const selected = selectRoutes(Class.name, routeNames, opts);

  // Instâncias permitem injetar dependências pelo construtor: app.mount(new UserRoutes(repo))
  const instance = isClass ? new Class() : ref;
  const prefix = opts.prefix ?? meta.prefix;
  const routes: CompiledRoute[] = [];

  for (const [name, methodMeta] of meta.methods) {
    if (!methodMeta.method || !methodMeta.path || !selected.has(String(name))) continue;
    const fn = (instance as Record<string | symbol, unknown>)[name];
    if (typeof fn !== 'function') continue;

    routes.push({
      method: methodMeta.method,
      path: joinPaths(prefix, methodMeta.path),
      handler: (ctx: Context) => fn.call(instance, ctx),
      schemas: methodMeta.schemas,
      // Ordem: composição (app.mount) → classe → método (F-01, F-28)
      middlewares: [...(opts.middlewares ?? []), ...meta.middlewares, ...methodMeta.middlewares],
      guards: [...(opts.guards ?? []), ...meta.guards, ...methodMeta.guards],
    });
  }

  return routes;
}

function selectRoutes(className: string, names: string[], opts: MountOptions): Set<string> {
  if (opts.only && opts.except) {
    throw new Error(`[sashiko] app.mount(${className}): use either "only" or "except", not both.`);
  }
  const listed = opts.only ?? opts.except ?? [];
  const unknown = listed.filter((n) => !names.includes(n));
  if (unknown.length > 0) {
    throw new Error(
      `[sashiko] app.mount(${className}): ${unknown.map((n) => `"${n}"`).join(', ')} ` +
      `is not a route method. Available: ${names.join(', ') || '(none)'}.`,
    );
  }
  if (opts.only) return new Set(opts.only);
  const except = new Set<string>(opts.except ?? []);
  return new Set(names.filter((n) => !except.has(n)));
}

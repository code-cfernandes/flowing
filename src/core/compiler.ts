import { readOwnMetadata } from './metadata.ts';
import type { Context } from './context.ts';
import type { RouteDefinition } from './router.ts';
import { joinPaths } from '../utils/path.ts';

export interface CompiledRoute extends RouteDefinition {
  method: string;
  path: string;
}

/** Classe com construtor sem argumentos **ou** instância já construída (B-10). */
export type ControllerRef = (new () => object) | object;

export function compileController(ref: ControllerRef): CompiledRoute[] {
  const isClass = typeof ref === 'function';
  const Class = (isClass ? ref : ref.constructor) as new () => object;
  const meta = readOwnMetadata(Class);
  if (!meta?.isController) {
    throw new Error(
      `Class ${Class.name} is not decorated with @Controller('/prefix'). ` +
      `Add it to use with app.controllers([...]).`
    );
  }

  // Instâncias permitem injetar dependências pelo construtor: controllers([new UserController(repo)])
  const instance = isClass ? new Class() : ref;
  const routes: CompiledRoute[] = [];

  for (const [name, methodMeta] of meta.methods) {
    if (!methodMeta.method || !methodMeta.path) continue;
    const fn = (instance as Record<string | symbol, unknown>)[name];
    if (typeof fn !== 'function') continue;

    routes.push({
      method: methodMeta.method,
      path: joinPaths(meta.prefix, methodMeta.path),
      handler: (ctx: Context) => fn.call(instance, ctx),
      schemas: methodMeta.schemas,
      // Ordem: classe → método (F-01)
      middlewares: [...meta.middlewares, ...methodMeta.middlewares],
      guards: [...meta.guards, ...methodMeta.guards],
    });
  }

  return routes;
}

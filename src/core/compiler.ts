import { readOwnMetadata, type RouteSchemas } from './metadata.ts';
import type { Context } from './context.ts';
import type { Handler } from './router.ts';

export interface CompiledRoute {
  method: string;
  path: string;
  handler: Handler;
  schemas: RouteSchemas;
}

export function compileController(Class: new () => any): CompiledRoute[] {
  const meta = readOwnMetadata(Class);
  if (!meta?.isController) {
    throw new Error(
      `Class ${Class.name} is not decorated with @Controller('/prefix'). ` +
      `Add it to use with app.controllers([...]).`
    );
  }

  const instance = new Class();
  const routes: CompiledRoute[] = [];

  for (const [name, methodMeta] of meta.methods) {
    if (!methodMeta.method || !methodMeta.path) continue;
    const fn = (instance as any)[name];
    if (typeof fn !== 'function') continue;

    routes.push({
      method: methodMeta.method,
      path: joinPaths(meta.prefix, methodMeta.path),
      handler: (ctx: Context) => fn.call(instance, ctx),
      schemas: methodMeta.schemas,
    });
  }

  return routes;
}

function joinPaths(prefix: string, path: string): string {
  const p = prefix.replace(/\/$/, '');
  const s = path.startsWith('/') ? path : `/${path}`;
  return `${p}${s}` || '/';
}
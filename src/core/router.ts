// src/core/router.ts
import Router from 'find-my-way';
import type { Middleware } from './compose.ts';
import type { Context } from './context.ts';
import type { Guard } from './guard.ts';
import type { RouteSchemas } from './metadata.ts';

export type Handler = (ctx: Context) => unknown | Promise<unknown>;

/** Tudo o que o app precisa para executar uma rota. */
export interface RouteDefinition {
  handler: Handler;
  schemas: RouteSchemas;
  middlewares: readonly Middleware[];
  guards: readonly Guard[];
}

export interface RouteMatch extends RouteDefinition {
  params: Record<string, string>;
}

type Method = Router.HTTPMethod;

// O find-my-way exige um handler próprio; usamos só o `store`, então ele nunca é chamado.
const NOOP: Router.Handler<Router.HTTPVersion.V1> = () => {};
const PROBE_METHODS: readonly Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export class PicoDecorRouter {
  private inner = Router({ ignoreTrailingSlash: true });

  on(method: string, path: string, route: RouteDefinition): void {
    this.inner.on(method as Method, path, NOOP, route);
  }

  find(method: string, path: string): RouteMatch | null {
    // F-08: HEAD usa o handler do GET quando não houver rota HEAD própria.
    // O Node já descarta o corpo de respostas a HEAD.
    const found = this.inner.find(method as Method, path)
      ?? (method === 'HEAD' ? this.inner.find('GET', path) : null);
    if (!found) return null;
    return { ...(found.store as RouteDefinition), params: found.params as Record<string, string> };
  }

  /**
   * Descobre quais métodos existem para o path informado.
   * Estratégia: pergunta ao find-my-way método por método.
   * O custo é O(número de métodos registrados) por lookup, o que é trivial
   * (no máximo 7 find() O(log n) cada).
   */
  allowedMethods(path: string): string[] {
    const methods = new Set<string>();
    for (const method of PROBE_METHODS) {
      if (this.inner.find(method, path)) {
        methods.add(method);
      }
    }
    if (methods.has('GET')) methods.add('HEAD');
    if (methods.size > 0) methods.add('OPTIONS');
    return [...methods].sort();
  }
}
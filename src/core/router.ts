// src/core/router.ts
import Router from 'find-my-way';
import type { RouteSchemas } from './metadata.ts';
import type { Context } from './context.ts';

export type Handler = (ctx: Context) => unknown | Promise<unknown>;

export interface RouteMatch {
  handler: Handler;
  params: Record<string, string>;
  schemas: RouteSchemas;
}

interface Store {
  handler: Handler;
}

const NOOP = (() => {}) as any;
const PROBE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export class PicoDecorRouter {
  private inner = Router({ ignoreTrailingSlash: true });
  private schemasByHandler = new WeakMap<Handler, RouteSchemas>();

  on(method: string, path: string, handler: Handler, schemas: RouteSchemas = {}): void {
    this.schemasByHandler.set(handler, schemas);
    const store: Store = { handler };
    this.inner.on(method as any, path, NOOP, store as any);
  }

  find(method: string, path: string): RouteMatch | null {
    const found = this.inner.find(method as any, path);
    if (!found) return null;
    const { handler } = found.store as unknown as Store;
    return {
      handler,
      params: found.params as Record<string, string>,
      schemas: this.schemasByHandler.get(handler) ?? {},
    };
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
      if (this.inner.find(method as any, path)) {
        methods.add(method);
      }
    }
    return [...methods].sort();
  }
}
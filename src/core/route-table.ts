// src/core/route-table.ts
import Router from 'find-my-way';
import type { Middleware } from './compose.ts';
import type { Context } from './context.ts';
import type { Guard } from './guard.ts';
import type { RouteSchemas } from './metadata.ts';
import { compileRouteHost, hostRank, type RouteHostRule } from '../utils/origin-match.ts';

export type Handler = (ctx: Context) => unknown | Promise<unknown>;

/** Tudo o que o app precisa para executar uma rota. */
export interface RouteDefinition {
  handler: Handler;
  schemas: RouteSchemas;
  middlewares: readonly Middleware[];
  guards: readonly Guard[];
}

/** Resultado do `find()`: a rota registrada (o mesmo objeto, sem cópia) e os parâmetros desta requisição. */
export interface RouteMatch {
  route: RouteDefinition & { run?: (ctx: Context) => Promise<void> | undefined };
  params: Record<string, string>;
}

type Method = Router.HTTPMethod;

// O find-my-way exige um handler próprio; usamos só o `store`, então ele nunca é chamado.
const NOOP: Router.Handler<Router.HTTPVersion.V1> = () => {};
const PROBE_METHODS: readonly Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** Converte a chave da restrição de volta na regra (`re:fonte/flags` → RegExp). */
function ruleFromKey(key: string): RouteHostRule {
  if (!key.startsWith('re:')) return compileRouteHost(key);
  const slash = key.lastIndexOf('/');
  return compileRouteHost(new RegExp(key.slice(3, slash), key.slice(slash + 1)));
}

/**
 * Estratégia de host própria (F-35), no lugar da embutida do find-my-way, que testa as RegExp na ordem de
 * registro. Aqui a prioridade é a de {@link hostRank}: exato → curinga mais específico → RegExp.
 */
const hostStrategy = {
  name: 'host',
  mustMatchWhenDerived: false,
  storage() {
    const exact = new Map<string, unknown>();
    const ranked: { rule: RouteHostRule; rank: number; value: unknown }[] = [];
    let seq = 0;
    return {
      get(hostname: string) {
        const hit = exact.get(hostname);
        if (hit !== undefined) return hit;
        for (const r of ranked) if (r.rule.test(hostname)) return r.value;
        return null;
      },
      set(key: string, value: unknown) {
        const rule = ruleFromKey(key);
        if (rule.kind === 'exact') return void exact.set(rule.base, value);
        const existing = ranked.find((r) => r.rule.key === key);
        if (existing) return void (existing.value = value);
        ranked.push({ rule, rank: hostRank(rule, seq++), value });
        ranked.sort((a, b) => a.rank - b.rank);
      },
    };
  },
  validate(value: unknown) {
    if (typeof value !== 'string') throw new Error('host constraint must be a compiled host key');
  },
  // O app sempre informa o host validado no `find()`; o header cru nunca é usado.
  deriveConstraint: () => '',
};

/** Tabela de rotas interna sobre o find-my-way. */
export class RouteTable {
  private inner = Router({ ignoreTrailingSlash: true, constraints: { host: hostStrategy as never } });

  /** Com `host` (chave da regra), a rota só casa naquele host (F-35); sem, vale para qualquer um (fallback). */
  on(method: string, path: string, route: RouteDefinition, host?: string): void {
    if (host === undefined) this.inner.on(method as Method, path, NOOP, route);
    else this.inner.on(method as Method, path, { constraints: { host } }, NOOP, route);
  }

  /** Desfaz um `on()`, para o registro em duas fases. */
  off(method: string, path: string, host?: string): void {
    if (host === undefined) this.inner.off(method as Method, path);
    else this.inner.off(method as Method, path, { host });
  }

  /** Já existe uma rota idêntica (método, path e host)? */
  has(method: string, path: string, host?: string): boolean {
    // Com `ignoreTrailingSlash`, `/users` e `/users/` são a mesma rota: confere as duas formas.
    const alt = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : `${path}/`;
    const c = host === undefined ? undefined : { host };
    return [path, alt].some((p) => (c ? this.inner.hasRoute(method as Method, p, c) : this.inner.hasRoute(method as Method, p)));
  }

  /** `hostname` é o validado pelo app (`ctx.hostname`), nunca o header cru. */
  find(method: string, path: string, hostname = ''): RouteMatch | null {
    const c = { host: hostname };
    // F-08: HEAD usa o handler do GET quando não houver rota HEAD própria.
    // O Node já descarta o corpo de respostas a HEAD.
    const found = this.inner.find(method as Method, path, c) ?? (method === 'HEAD' ? this.inner.find('GET', path, c) : null);
    if (!found) return null;
    return { route: found.store as RouteMatch['route'], params: found.params as Record<string, string> };
  }

  /**
   * Descobre quais métodos existem para o path informado.
   * Estratégia: pergunta ao find-my-way método por método.
   * O custo é O(número de métodos registrados) por lookup, o que é trivial
   * (no máximo 7 find() O(log n) cada).
   */
  allowedMethods(path: string, hostname = ''): string[] {
    const methods = new Set<string>();
    for (const method of PROBE_METHODS) {
      if (this.inner.find(method, path, { host: hostname })) {
        methods.add(method);
      }
    }
    if (methods.has('GET')) methods.add('HEAD');
    if (methods.size > 0) methods.add('OPTIONS');
    return [...methods].sort();
  }
}

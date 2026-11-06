// src/core/metadata.ts
import type { Middleware } from './compose.ts';
import type { Guard } from './guard.ts';
export const ROUTER_METADATA = Symbol.for('pico:router');

export interface RouteSchemas {
  params?: object;
  body?: object;
  query?: object;
  headers?: object;
  response?: Record<number, object>;
}

export interface MethodMetadata {
  method?: string;
  path?: string;
  schemas: RouteSchemas;
  handlerName?: string | symbol;
  /** `@Use` no método (F-01). */
  middlewares: Middleware[];
  /** `@UseGuards` no método (F-01). */
  guards: Guard[];
}

export interface RouterMetadata {
  /** `true` apenas quando a própria classe recebeu `@Router` (não herda). */
  isRouter: boolean;
  prefix: string;
  methods: Map<string | symbol, MethodMetadata>;
  /** `@Use` na classe: valem para todas as rotas da classe (F-01). */
  middlewares: Middleware[];
  /** `@UseGuards` na classe (F-01). */
  guards: Guard[];
}

/**
 * Retorna a metadata **própria** da classe.
 *
 * Em subclasses, `context.metadata` herda do pai via protótipo. Ler a chave direto
 * devolveria o objeto do pai, e qualquer escrita o corromperia (B-09). Por isso
 * clonamos a metadata herdada na primeira escrita (copy-on-write): a subclasse
 * herda as rotas do pai, mas nunca altera a classe base.
 */
export function getOrCreateMetadata(meta: DecoratorMetadataObject): RouterMetadata {
  if (Object.hasOwn(meta, ROUTER_METADATA)) {
    return meta[ROUTER_METADATA] as RouterMetadata;
  }
  const inherited = meta[ROUTER_METADATA] as RouterMetadata | undefined;
  const own: RouterMetadata = {
    isRouter: false,
    prefix: '',
    methods: new Map(
      [...(inherited?.methods ?? [])].map(([name, m]) => [
        name,
        { ...m, schemas: { ...m.schemas }, middlewares: [...m.middlewares], guards: [...m.guards] },
      ]),
    ),
    // A subclasse herda os middlewares/guards de classe do pai e pode acrescentar os seus.
    middlewares: [...(inherited?.middlewares ?? [])],
    guards: [...(inherited?.guards ?? [])],
  };
  meta[ROUTER_METADATA] = own;
  return own;
}

/** Lê a metadata própria de uma classe já decorada, sem criar nem herdar. */
export function readOwnMetadata(Class: object): RouterMetadata | undefined {
  if (!Object.hasOwn(Class, Symbol.metadata)) return undefined;
  const meta = (Class as { [Symbol.metadata]?: DecoratorMetadataObject | null })[Symbol.metadata];
  if (!meta || !Object.hasOwn(meta, ROUTER_METADATA)) return undefined;
  return meta[ROUTER_METADATA] as RouterMetadata;
}

/**
 * Ponto de entrada dos decorators: valida o ambiente e devolve a metadata própria da classe.
 *
 * - R-02: com `experimentalDecorators`, o TypeScript chama o decorator com
 *   `(target, propertyKey, descriptor)` em vez de `(value, context)`.
 * - R-01: sem `Symbol.metadata`, o `context.metadata` chega `undefined` e não há onde guardar as rotas.
 *
 * Nos dois casos, falhamos cedo com uma mensagem que diz como resolver.
 */
export function metadataFor(context: unknown, decorator: string): RouterMetadata {
  if (typeof context !== 'object' || context === null || !('kind' in context)) {
    throw new Error(
      `[picodecor] @${decorator} received legacy decorator arguments. PicoDecor uses standard (TC39) ` +
      `decorators: remove "experimentalDecorators" (and "emitDecoratorMetadata") from your tsconfig.json.`,
    );
  }
  const meta = (context as { metadata?: DecoratorMetadataObject | null }).metadata;
  if (!meta) {
    throw new Error(
      `[picodecor] @${decorator}: decorator metadata is unavailable (Symbol.metadata is not defined). ` +
      `Import 'picodecor' before declaring routers, or use TypeScript >= 5.2 / a runtime with decorator metadata.`,
    );
  }
  return getOrCreateMetadata(meta);
}

export function getOrCreateMethod(meta: RouterMetadata, name: string | symbol): MethodMetadata {
  let m = meta.methods.get(name);
  if (!m) {
    m = { schemas: {}, handlerName: name, middlewares: [], guards: [] };
    meta.methods.set(name, m);
  }
  return m;
}

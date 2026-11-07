// src/core/metadata.ts
import type { Middleware } from './compose.ts';
import type { Guard } from './guard.ts';
import { concatHooks, emptyHooks, type ScopedHooks } from './hooks.ts';
export const ROUTER_METADATA = Symbol.for('sashiko:router');

/**
 * Resposta com tipo de conteúdo declarado (F-31). Sem `contentType`, a entrada é um schema JSON.
 *
 * ```ts
 * response: { 200: { contentType: ['application/json', 'text/csv'], schema: Users } }
 * ```
 */
export interface ResponseContent {
  /** Um tipo ou a lista de tipos oferecidos; com vários, o cliente escolhe pelo `Accept`. */
  contentType: string | readonly string[];
  /** Schema dos dados. Em formatos não JSON, valida e remove campos antes do serializador. */
  schema?: object;
}

/** Schema JSON (como sempre) ou `{ contentType, schema? }`. */
export type ResponseEntry = object | ResponseContent;

export interface RouteSchemas {
  params?: object;
  body?: object;
  query?: object;
  headers?: object;
  response?: Record<number, ResponseEntry>;
}

export function isResponseContent(entry: unknown): entry is ResponseContent {
  if (typeof entry !== 'object' || entry === null || !('contentType' in entry)) return false;
  const ct = (entry as { contentType: unknown }).contentType;
  return typeof ct === 'string' || Array.isArray(ct);
}

export interface MethodMetadata {
  method?: string;
  path?: string;
  schemas: RouteSchemas;
  handlerName?: string | symbol;
  /** `@Middlewares` no método (F-01). */
  middlewares: Middleware[];
  /** `@Guards` no método (F-01). */
  guards: Guard[];
  /** `@OnSend`, `@OnResponse` e `@OnError` no método (F-43). */
  hooks: ScopedHooks;
}

export interface RouterMetadata {
  /** `true` apenas quando a própria classe recebeu `@Router` (não herda). */
  isRouter: boolean;
  prefix: string;
  methods: Map<string | symbol, MethodMetadata>;
  /** `@Middlewares` na classe: valem para todas as rotas da classe (F-01). */
  middlewares: Middleware[];
  /** `@Guards` na classe (F-01). */
  guards: Guard[];
  /** Hooks da classe (F-43). */
  hooks: ScopedHooks;
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
        { ...m, schemas: { ...m.schemas }, middlewares: [...m.middlewares], guards: [...m.guards], hooks: concatHooks(m.hooks) },
      ]),
    ),
    // A subclasse herda os middlewares/guards de classe do pai e pode acrescentar os seus.
    middlewares: [...(inherited?.middlewares ?? [])],
    guards: [...(inherited?.guards ?? [])],
    hooks: concatHooks(inherited?.hooks ?? emptyHooks()),
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
      `[sashiko] @${decorator} received legacy decorator arguments. Sashiko uses standard (TC39) ` +
        `decorators: remove "experimentalDecorators" (and "emitDecoratorMetadata") from your tsconfig.json.`,
    );
  }
  const meta = (context as { metadata?: DecoratorMetadataObject | null }).metadata;
  if (!meta) {
    throw new Error(
      `[sashiko] @${decorator}: decorator metadata is unavailable (Symbol.metadata is not defined). ` +
        `Import 'sashiko' before declaring routers, or use TypeScript >= 5.2 / a runtime with decorator metadata.`,
    );
  }
  return getOrCreateMetadata(meta);
}

/**
 * Junta schemas vindos de `@Get(path, schemas)` e de `@Schema(...)` no mesmo método.
 * Partes diferentes se combinam; a mesma parte declarada duas vezes é erro, para não haver
 * dúvida sobre qual vale.
 */
export function mergeSchemas(method: MethodMetadata, schemas: RouteSchemas, where: string): void {
  for (const key of Object.keys(schemas) as (keyof RouteSchemas)[]) {
    if (schemas[key] === undefined) continue;
    if (method.schemas[key] !== undefined) {
      throw new Error(
        `[sashiko] ${where}: schema "${key}" is declared twice for ${String(method.handlerName)}. ` +
          `Declare each part either in the HTTP decorator or in @Schema, not both.`,
      );
    }
  }
  method.schemas = { ...method.schemas, ...schemas };
}

export function getOrCreateMethod(meta: RouterMetadata, name: string | symbol): MethodMetadata {
  let m = meta.methods.get(name);
  if (!m) {
    m = { schemas: {}, handlerName: name, middlewares: [], guards: [], hooks: emptyHooks() };
    meta.methods.set(name, m);
  }
  return m;
}

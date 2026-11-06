// src/core/metadata.ts
export const CONTROLLER_METADATA = Symbol.for('pico:controller');

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
}

export interface ControllerMetadata {
  /** `true` apenas quando a própria classe recebeu `@Controller` (não herda). */
  isController: boolean;
  prefix: string;
  methods: Map<string | symbol, MethodMetadata>;
}

/**
 * Retorna a metadata **própria** da classe.
 *
 * Em subclasses, `context.metadata` herda do pai via protótipo. Ler a chave direto
 * devolveria o objeto do pai, e qualquer escrita o corromperia (B-09). Por isso
 * clonamos a metadata herdada na primeira escrita (copy-on-write): a subclasse
 * herda as rotas do pai, mas nunca altera a classe base.
 */
export function getOrCreateMetadata(meta: DecoratorMetadataObject): ControllerMetadata {
  if (Object.hasOwn(meta, CONTROLLER_METADATA)) {
    return meta[CONTROLLER_METADATA] as ControllerMetadata;
  }
  const inherited = meta[CONTROLLER_METADATA] as ControllerMetadata | undefined;
  const own: ControllerMetadata = {
    isController: false,
    prefix: '',
    methods: new Map(
      [...(inherited?.methods ?? [])].map(([name, m]) => [name, { ...m, schemas: { ...m.schemas } }]),
    ),
  };
  meta[CONTROLLER_METADATA] = own;
  return own;
}

/** Lê a metadata própria de uma classe já decorada, sem criar nem herdar. */
export function readOwnMetadata(Class: object): ControllerMetadata | undefined {
  if (!Object.hasOwn(Class, Symbol.metadata)) return undefined;
  const meta = (Class as { [Symbol.metadata]?: DecoratorMetadataObject | null })[Symbol.metadata];
  if (!meta || !Object.hasOwn(meta, CONTROLLER_METADATA)) return undefined;
  return meta[CONTROLLER_METADATA] as ControllerMetadata;
}

export function getOrCreateMethod(meta: ControllerMetadata, name: string | symbol): MethodMetadata {
  let m = meta.methods.get(name);
  if (!m) {
    m = { schemas: {}, handlerName: name };
    meta.methods.set(name, m);
  }
  return m;
}

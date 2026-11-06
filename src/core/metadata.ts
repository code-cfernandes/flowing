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
  prefix: string;
  methods: Map<string | symbol, MethodMetadata>;
}

export function getOrCreateMetadata(meta: DecoratorMetadataObject): ControllerMetadata {
  let m = meta[CONTROLLER_METADATA] as ControllerMetadata | undefined;
  if (!m) {
    m = { prefix: '', methods: new Map() };
    meta[CONTROLLER_METADATA] = m;
  }
  return m;
}

export function getOrCreateMethod(meta: ControllerMetadata, name: string | symbol): MethodMetadata {
  let m = meta.methods.get(name);
  if (!m) {
    m = { schemas: {}, handlerName: name };
    meta.methods.set(name, m);
  }
  return m;
}
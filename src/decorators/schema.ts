import { getOrCreateMetadata, getOrCreateMethod, type RouteSchemas } from './metadata.ts';

export function Schema(schemas: RouteSchemas) {
  return function <This, Args extends [any, ...unknown[]], Return>(
    _target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>
  ) {
    const meta = getOrCreateMetadata(context.metadata);
    const m = getOrCreateMethod(meta, context.name);
    m.schemas = { ...m.schemas, ...schemas };
  };
}
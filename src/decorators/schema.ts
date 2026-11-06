import { getOrCreateMethod, mergeSchemas, metadataFor, type RouteSchemas } from '../core/metadata.ts';

/**
 * Schemas da rota em um decorator separado, para quem prefere manter o verbo enxuto.
 * Equivale ao segundo argumento de `@Get`/`@Post`/…; as duas formas podem conviver no mesmo método,
 * desde que não declarem a mesma parte (ex.: `body`) duas vezes.
 */
export function Schema(schemas: RouteSchemas) {
  return function <This, Args extends [any, ...unknown[]], Return>(
    _target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
  ) {
    const meta = metadataFor(context, 'Schema');
    mergeSchemas(getOrCreateMethod(meta, context.name), schemas, '@Schema');
  };
}

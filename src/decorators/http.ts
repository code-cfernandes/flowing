import { getOrCreateMethod, mergeSchemas, metadataFor, type RouteSchemas } from '../core/metadata.ts';

function methodDecorator(httpMethod: string, path: string, schemas?: RouteSchemas) {
  const label = httpMethod[0] + httpMethod.slice(1).toLowerCase();
  return function <This, Args extends [any, ...unknown[]], Return>(
    _target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
  ) {
    const meta = metadataFor(context, label);
    const m = getOrCreateMethod(meta, context.name);
    m.method = httpMethod;
    m.path = path;
    if (schemas) mergeSchemas(m, schemas, `@${label}`);
  };
}

/**
 * Decorators de rota. O segundo argumento, opcional, são os schemas da rota: o mesmo que `@Schema`,
 * na mesma linha do verbo.
 *
 * ```ts
 * @Get('/:id', byId)
 * getUser(ctx: Context<typeof byId>) {}
 * ```
 */
export const Get = (path = '/', schemas?: RouteSchemas) => methodDecorator('GET', path, schemas);
export const Post = (path = '/', schemas?: RouteSchemas) => methodDecorator('POST', path, schemas);
export const Put = (path = '/', schemas?: RouteSchemas) => methodDecorator('PUT', path, schemas);
export const Patch = (path = '/', schemas?: RouteSchemas) => methodDecorator('PATCH', path, schemas);
export const Delete = (path = '/', schemas?: RouteSchemas) => methodDecorator('DELETE', path, schemas);

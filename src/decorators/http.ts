import type { CheckParams } from '../core/infer.ts';
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
type Verb = <const P extends string = '/', const S extends RouteSchemas = {}>(
  path?: P,
  schemas?: S & CheckParams<P, S>,
) => ReturnType<typeof methodDecorator>;

const verb = (httpMethod: string): Verb => (path, schemas) => methodDecorator(httpMethod, path ?? '/', schemas);

/** Com schema de `params`, as chaves precisam ser exatamente as do path, ou o TypeScript acusa (F-29). */
export const Get = verb('GET');
export const Post = verb('POST');
export const Put = verb('PUT');
export const Patch = verb('PATCH');
export const Delete = verb('DELETE');

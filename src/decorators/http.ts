import { metadataFor, getOrCreateMethod } from '../core/metadata.ts';

function methodDecorator(httpMethod: string, path: string) {
  const label = httpMethod[0] + httpMethod.slice(1).toLowerCase();
  return function <This, Args extends [any, ...unknown[]], Return>(
    _target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>
  ) {
    const meta = metadataFor(context, label);
    const m = getOrCreateMethod(meta, context.name);
    m.method = httpMethod;
    m.path = path;
  };
}

export const Get = (path = '/') => methodDecorator('GET', path);
export const Post = (path = '/') => methodDecorator('POST', path);
export const Put = (path = '/') => methodDecorator('PUT', path);
export const Patch = (path = '/') => methodDecorator('PATCH', path);
export const Delete = (path = '/') => methodDecorator('DELETE', path);
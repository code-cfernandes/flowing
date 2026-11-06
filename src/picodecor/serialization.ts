import fastJson from 'fast-json-stringify';

const cache = new WeakMap<object, (data: unknown) => string>();

export function serialize(schema: object, data: unknown): string {
  let fn = cache.get(schema);
  if (!fn) {
    fn = fastJson(schema as any);
    cache.set(schema, fn);
  }
  return fn(data);
}
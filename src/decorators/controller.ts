import { getOrCreateMetadata } from './metadata.ts';

export function Controller(prefix = '') {
  return function <T extends new (...args: any[]) => any>(_value: T, context: ClassDecoratorContext<T>) {
    const meta = getOrCreateMetadata(context.metadata);
    meta.prefix = prefix;
  };
}
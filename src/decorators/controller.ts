import { getOrCreateMetadata } from '../core/metadata.ts';

export function Controller(prefix = '') {
  return function <T extends new (...args: any[]) => any>(_value: T, context: ClassDecoratorContext<T>) {
    const meta = getOrCreateMetadata(context.metadata);
    meta.prefix = prefix;
  };
}
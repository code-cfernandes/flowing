import { metadataFor } from '../core/metadata.ts';

export function Controller(prefix = '') {
  return function <T extends new (...args: any[]) => any>(_value: T, context: ClassDecoratorContext<T>) {
    const meta = metadataFor(context, 'Controller');
    meta.isController = true;
    meta.prefix = prefix;
  };
}
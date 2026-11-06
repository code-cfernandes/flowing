import { metadataFor } from '../core/metadata.ts';

/**
 * Marca a classe como um grupo de rotas que o app pode registrar com `app.mount()` (F-28)
 * e define o prefixo padrão. Sem `@Router` próprio, a classe é recusada.
 *
 * ```ts
 * @Router('/users')
 * class UserRoutes { @Get('/:id') getById() {} }
 * app.mount(UserRoutes);
 * ```
 */
export function Router(prefix = '') {
  return function <T extends abstract new (...args: any[]) => object>(_value: T, context: ClassDecoratorContext<T>) {
    const meta = metadataFor(context, 'Router');
    meta.isRouter = true;
    meta.prefix = prefix;
  };
}

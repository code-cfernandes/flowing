import type { Middleware } from '../core/compose.ts';
import type { Guard } from '../core/guard.ts';
import { getOrCreateMethod, metadataFor } from '../core/metadata.ts';

type ClassOrMethodContext = ClassDecoratorContext | ClassMethodDecoratorContext;

/**
 * Aplica `items` na classe (todas as rotas) ou no método. Decorators são avaliados de baixo para
 * cima; inserimos no início para que a ordem de execução siga a ordem de leitura (de cima para baixo).
 */
function register(decorator: string, pick: 'middlewares' | 'guards', items: readonly unknown[]) {
  return function (_value: unknown, context: ClassOrMethodContext): void {
    const meta = metadataFor(context, decorator);
    const target = context.kind === 'class' ? meta : getOrCreateMethod(meta, context.name);
    (target[pick] as unknown[]).unshift(...items);
  };
}

/**
 * Middlewares por controller ou por rota (F-01). Rodam depois dos globais e antes dos guards.
 *
 * ```ts
 * @Use(rateLimit({ max: 10 }))          // todas as rotas do controller
 * @Controller('/auth')
 * class AuthController {
 *   @Use(audit) @Post('/login') login() {}
 * }
 * ```
 */
export function Use(...middlewares: Middleware[]) {
  return register('Use', 'middlewares', middlewares);
}

/**
 * Guards por controller ou por rota (F-01). Rodam antes da validação; `false` responde 403.
 *
 * ```ts
 * const isAdmin: Guard = (ctx) => ctx.state.user?.role === 'admin';
 * @UseGuards(isAdmin) @Delete('/:id') remove() {}
 * ```
 */
export function UseGuards(...guards: Guard[]) {
  return register('UseGuards', 'guards', guards);
}

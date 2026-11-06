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
 * Middlewares para todas as rotas da classe ou para um método (F-01, F-30). Rodam depois dos globais
 * e dos `middlewares` do `mount`, e antes dos guards. É o mesmo nome da opção `middlewares`.
 *
 * ```ts
 * @Middlewares(rateLimit({ max: 10 }))   // todas as rotas da classe
 * @Router('/auth')
 * class AuthRoutes {
 *   @Middlewares(audit) @Post('/login') login() {}
 * }
 * ```
 */
export function Middlewares(...middlewares: Middleware[]) {
  return register('Middlewares', 'middlewares', middlewares);
}

/**
 * Guards para todas as rotas da classe ou para um método (F-01, F-30). Rodam antes da validação;
 * `false` responde 403. É o mesmo nome da opção `guards`.
 *
 * ```ts
 * const isAdmin: Guard = (ctx) => ctx.state.user?.role === 'admin';
 * @Guards(isAdmin) @Delete('/:id') remove() {}
 * ```
 */
export function Guards(...guards: Guard[]) {
  return register('Guards', 'guards', guards);
}

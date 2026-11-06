import type { Context } from './context.ts';
import type { Middleware } from './compose.ts';
import { HttpError } from './errors.ts';

/**
 * Decide se a requisição pode seguir para o handler (F-01).
 * Retorne `false` para responder 403, ou lance um `HttpError` (ex.: `unauthorized()`) para outro status.
 */
export type Guard = (ctx: Context) => boolean | Promise<boolean>;

/** Executa os guards em ordem; o primeiro que negar interrompe a requisição. */
export function guardsMiddleware(guards: readonly Guard[]): Middleware {
  return async (ctx, next) => {
    for (const guard of guards) {
      if (!(await guard(ctx))) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
    }
    await next();
  };
}

import type { Context } from './context.ts';

export type Middleware = (ctx: Context, next: () => Promise<void>) => Promise<void> | void;

export async function compose(ctx: Context, fns: Middleware[]): Promise<void> {
  let i = 0;
  const dispatch = async (): Promise<void> => {
    if (i >= fns.length) return;
    const fn = fns[i++]!;
    await fn(ctx, dispatch);
  };
  await dispatch();
}

/** Uma etapa do pipeline: `undefined` quando terminou de forma síncrona, ou a Promise do que é assíncrono. */
export type Step = Promise<void> | undefined;

/** Promise já resolvida, compartilhada: `next()` de uma etapa síncrona devolve esta, sem alocar (F-41). */
const DONE: Promise<void> = Promise.resolve();

/** Se `value` é uma Promise (ou um thenable), para decidir entre o caminho síncrono e o assíncrono. */
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Cadeia pré-compilada (Chain of Responsibility, F-39): monta, uma vez, a função que executa `fns` no modelo
 * onion e termina em `terminal`. Sem camadas, a cadeia é o próprio terminal, que pode terminar de forma
 * síncrona (F-41). Com camadas, os middlewares são assíncronos por contrato (`await next()`).
 *
 * Como no `compose`, chamar `next()` de novo depois que a cadeia seguinte já rodou não a executa outra vez.
 */
export function compileChain(fns: readonly Middleware[], terminal: (ctx: Context) => Step): (ctx: Context) => Step {
  let run = terminal;
  for (let i = fns.length - 1; i >= 0; i--) {
    const fn = fns[i]!;
    const inner = run;
    run = async (ctx) => {
      let called = false;
      await fn(ctx, () => {
        if (called) return DONE;
        called = true;
        return inner(ctx) ?? DONE;
      });
    };
  }
  return run;
}

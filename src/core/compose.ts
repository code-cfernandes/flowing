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

/**
 * Cadeia pré-compilada (Chain of Responsibility, F-39): monta, uma vez, a função que executa `fns` no modelo
 * onion e termina em `terminal`. A cada requisição só se cria o `next` de cada camada.
 *
 * Como no `compose`, chamar `next()` de novo depois que a cadeia seguinte já rodou não a executa outra vez.
 */
export function compileChain(fns: readonly Middleware[], terminal: (ctx: Context) => Promise<void>): (ctx: Context) => Promise<void> {
  // Sem camadas, a cadeia é o próprio terminal: nenhuma função async a mais por requisição (F-41).
  let run = terminal;
  for (let i = fns.length - 1; i >= 0; i--) {
    const fn = fns[i]!;
    const inner = run;
    run = async (ctx) => {
      let called = false;
      await fn(ctx, () => {
        if (called) return Promise.resolve();
        called = true;
        return inner(ctx);
      });
    };
  }
  return run;
}

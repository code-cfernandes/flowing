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
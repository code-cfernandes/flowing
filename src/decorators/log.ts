import { performance } from 'node:perf_hooks';

export interface TimerOptions {
  /** Destino da medição. Padrão: `console.debug`. */
  log?: (message: string, ms: number) => void;
}

/**
 * Mede o tempo do handler, inclusive de handlers `async` (B-04).
 * Uso: `@timer()` ou `@timer({ log: (msg, ms) => logger.info({ ms }, msg) })`.
 */
export function timer(opts: TimerOptions = {}) {
  const log = opts.log ?? ((msg: string) => console.debug(msg));

  return function <This, Args extends unknown[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
  ) {
    const name = String(context.name);
    const report = (start: number) => {
      const ms = performance.now() - start;
      log(`${name} took ${ms.toFixed(2)}ms`, ms);
    };

    return function (this: This, ...args: Args): Return {
      const start = performance.now();
      let result: Return;
      try {
        result = target.call(this, ...args);
      } catch (err) {
        report(start);
        throw err;
      }
      if (result instanceof Promise) {
        return result.finally(() => report(start)) as Return;
      }
      report(start);
      return result;
    };
  };
}

import type { Context } from './context.ts';
import { compose, type Middleware } from './compose.ts';
import { kRawSend } from './symbols.ts';
import { guardsMiddleware, type Guard } from './guard.ts';
import type { Logger } from './logger.ts';
import { canonicalPath } from '../utils/path.ts';

/** Uma verificação de prontidão: lance um erro ou devolva `false` para indicar falha. */
export type HealthCheck = () => unknown | Promise<unknown>;

export interface HealthOptions {
  /** Liveness. Padrão: `'/livez'`; `false` desliga. */
  live?: string | false;
  /** Readiness. Padrão: `'/readyz'`; `false` desliga. */
  ready?: string | false;
  /** Verificações do `/readyz`, rodadas em paralelo: `{ db: () => db.ping() }`. */
  checks?: Record<string, HealthCheck>;
  /** Tempo máximo de cada verificação. Padrão: 2000 ms. */
  timeoutMs?: number;
  /** Rodam antes de responder (os middlewares globais não rodam nestas rotas). */
  middlewares?: readonly Middleware[];
  guards?: readonly Guard[];
  /**
   * Responde mesmo com um `Host` fora do `allowedHosts`. Sondas de orquestradores chegam com o IP do pod
   * no `Host` (Kubernetes, ECS). Um `Host` malformado continua recebendo 400. Padrão: `true`.
   */
  anyHost?: boolean;
}

/** @internal */
export interface HealthConfig {
  /** Responde se a requisição for para uma das rotas; devolve `true` nesse caso. */
  serve(ctx: Context, shuttingDown: boolean): Promise<boolean>;
  /** Paths das rotas ligadas, na forma canônica. */
  readonly paths: readonly string[];
  /** A requisição é para um healthcheck que aceita qualquer host? */
  bypassesHostCheck(method: string, path: string): boolean;
}

type CheckResult = 'ok' | 'error' | 'timeout';

function withTimeout(check: HealthCheck, ms: number): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<CheckResult>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  const run = Promise.resolve()
    .then(check)
    .then((v): CheckResult => (v === false ? 'error' : 'ok'));
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}

export function compileHealth(opts: HealthOptions, log: Logger): HealthConfig {
  const live = opts.live === undefined ? '/livez' : opts.live;
  const ready = opts.ready === undefined ? '/readyz' : opts.ready;
  if (live && ready && canonicalPath(live) === canonicalPath(ready)) {
    throw new Error(`[sashiko] health(): "live" and "ready" cannot both be "${live}".`);
  }
  const livePath = live === false ? undefined : canonicalPath(live);
  const readyPath = ready === false ? undefined : canonicalPath(ready);
  const anyHost = opts.anyHost ?? true;
  const isHealth = (method: string, path: string) =>
    (method === 'GET' || method === 'HEAD') && (canonicalPath(path) === livePath || canonicalPath(path) === readyPath);
  const checks = Object.entries(opts.checks ?? {});
  const timeoutMs = opts.timeoutMs ?? 2000;
  const pipeline: Middleware[] = [...(opts.middlewares ?? [])];
  if (opts.guards?.length) pipeline.push(guardsMiddleware(opts.guards));

  const reply = (ctx: Context, status: number, body: unknown) => {
    ctx.res.statusCode = status;
    ctx.res.setHeader('Cache-Control', 'no-store');
    ctx[kRawSend](JSON.stringify(body), 'application/json; charset=utf-8');
  };

  return {
    paths: [livePath, readyPath].filter((p): p is string => p !== undefined),
    bypassesHostCheck: (method, path) => anyHost && isHealth(method, path),
    async serve(ctx, shuttingDown) {
      if (!isHealth(ctx.method, ctx.path)) return false;
      const isLive = canonicalPath(ctx.path) === livePath;

      await compose(ctx, [
        ...pipeline,
        async () => {
          if (isLive) return reply(ctx, 200, { status: 'ok' });
          if (shuttingDown) return reply(ctx, 503, { status: 'shutting_down' });
          const results = await Promise.all(
            checks.map(async ([name, check]) => {
              const result = await withTimeout(check, timeoutMs).catch((err: unknown) => {
                // O motivo vai para o log, nunca para a resposta (pode conter host, usuário do banco…).
                log.warn({ err, check: name }, 'health check failed');
                return 'error' as const;
              });
              if (result === 'timeout') log.warn({ check: name, timeoutMs }, 'health check timed out');
              return [name, result] as const;
            }),
          );
          const failed = results.some(([, r]) => r !== 'ok');
          reply(ctx, failed ? 503 : 200, { status: failed ? 'error' : 'ok', checks: Object.fromEntries(results) });
        },
      ]);
      return true;
    },
  };
}

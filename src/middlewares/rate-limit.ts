import type { Context } from '../core/context.ts';
import type { Middleware } from '../core/compose.ts';
import { HttpError } from '../core/errors.ts';

export interface RateLimitStore {
  /** Incrementa o contador da chave e retorna o total e quando a janela reinicia (epoch ms). */
  hit(key: string, windowMs: number): { count: number; resetAt: number } | Promise<{ count: number; resetAt: number }>;
}

export interface RateLimitOptions {
  /** Máximo de requisições por janela. */
  max: number;
  /** Tamanho da janela em ms. Padrão: 60_000. */
  windowMs?: number;
  /** Chave de agrupamento. Padrão: IP do socket (`ctx.ip`). */
  key?: (ctx: Context) => string;
  /** Store plugável (Redis etc.). Padrão: memória local. */
  store?: RateLimitStore;
}

/** Store em memória, janela fixa. Adequado para uma única instância. */
export class MemoryRateLimitStore implements RateLimitStore {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private sweeper: NodeJS.Timeout;

  constructor(sweepEveryMs = 60_000) {
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    }, sweepEveryMs);
    this.sweeper.unref();
  }

  hit(key: string, windowMs: number) {
    const now = Date.now();
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      this.hits.set(key, entry);
    }
    entry.count++;
    return { ...entry };
  }
}

/** Rate limiting por chave (S-06). Responde 429 com `Retry-After` ao exceder. */
export function rateLimit(opts: RateLimitOptions): Middleware {
  const windowMs = opts.windowMs ?? 60_000;
  const store = opts.store ?? new MemoryRateLimitStore();
  const keyOf = opts.key ?? ((ctx: Context) => ctx.ip);

  return async (ctx, next) => {
    const { count, resetAt } = await store.hit(keyOf(ctx), windowMs);
    const remaining = Math.max(0, opts.max - count);
    const resetSec = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
    ctx.res.setHeader('RateLimit-Limit', String(opts.max));
    ctx.res.setHeader('RateLimit-Remaining', String(remaining));
    ctx.res.setHeader('RateLimit-Reset', String(resetSec));
    if (count > opts.max) {
      ctx.res.setHeader('Retry-After', String(resetSec));
      throw new HttpError(429, 'Too Many Requests', 'RATE_LIMITED');
    }
    await next();
  };
}

import type { Middleware } from "sashiko";

interface Entry { body: Buffer; type: string; expiresAt: number }

/**
 * Cache em memória por URL para respostas 200 (F-04). Usa `ctx.sentBody`, o corpo exatamente como
 * foi escrito e já filtrado pelo schema, então o cache nunca guarda campos não declarados.
 * Para várias instâncias, troque o Map por Redis.
 */
export function cache(ttlMs: number): Middleware {
  const store = new Map<string, Entry>();
  return async (ctx, next) => {
    const key = `${ctx.method} ${ctx.url.href} ${ctx.get('accept') ?? ''}`;
    const hit = store.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return void ctx.header('X-Cache', 'HIT').send(hit.body, hit.type);
    }
    ctx.header('X-Cache', 'MISS'); // antes do next(): depois dele, a resposta já foi enviada
    await next();
    if (ctx.res.statusCode === 200 && ctx.sentBody && ctx.sentType) {
      store.set(key, { body: ctx.sentBody, type: ctx.sentType, expiresAt: Date.now() + ttlMs });
    }
  };
}

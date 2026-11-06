const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Padrão do `node:querystring`: limita o custo de queries gigantes (S-06). */
export const DEFAULT_MAX_QUERY_KEYS = 1000;

export type ParsedQuery = Record<string, string | string[]>;

/**
 * Converte `URLSearchParams` em objeto (B-07):
 * - chaves repetidas viram array (`?tag=a&tag=b` → `{ tag: ['a', 'b'] }`);
 * - `__proto__`, `constructor` e `prototype` são descartadas (S-08);
 * - pares além de `maxKeys` são ignorados (S-06).
 *
 * Usa `URLSearchParams` (WHATWG) em vez do `node:querystring`, que é legado.
 */
export function parseQuery(params: URLSearchParams, maxKeys = DEFAULT_MAX_QUERY_KEYS): ParsedQuery {
  const out: ParsedQuery = {};
  let count = 0;
  for (const [key, value] of params) {
    if (count++ >= maxKeys) break;
    if (UNSAFE_KEYS.has(key)) continue;
    const prev = out[key];
    if (prev === undefined) out[key] = value;
    else if (Array.isArray(prev)) prev.push(value);
    else out[key] = [prev, value];
  }
  return out;
}

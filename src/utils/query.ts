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

/**
 * Parser de query próprio (F-26): recebe a query sem o `?` e devolve um objeto. Use para sintaxes que o parser padrão
 * não entende, como `?filter[status]=ativo` com o `qs`. Os limites (número de chaves, profundidade) passam a ser do
 * parser: o `queryMaxKeys` vale só para o padrão.
 */
export type QueryParser = (rawQuery: string) => Record<string, unknown>;

/** Chaves que reabririam prototype pollution (S-08) num objeto aninhado. */
function dropUnsafe(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value) || depth > 32) return undefined;
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => dropUnsafe(v, seen, depth + 1));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key)) continue;
    out[key] = dropUnsafe((value as Record<string, unknown>)[key], seen, depth + 1);
  }
  return out;
}

/** Erro de um parser de query próprio: vira 400, sem expor a mensagem original. */
export class InvalidQueryError extends Error {
  override readonly name = 'InvalidQueryError';
}

/**
 * Roda um parser próprio e passa o resultado pelo mesmo filtro de chaves perigosas do padrão, de forma recursiva:
 * um parser mal configurado não reabre o S-08.
 */
export function parseCustomQuery(parser: QueryParser, search: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parser(search.startsWith('?') ? search.slice(1) : search);
  } catch {
    throw new InvalidQueryError('query parser failed');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new InvalidQueryError('query parser returned a non-object');
  return dropUnsafe(parsed, new WeakSet(), 0) as Record<string, unknown>;
}

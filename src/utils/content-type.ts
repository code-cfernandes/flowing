/** Media type sem parâmetros e em minúsculas: `"Application/JSON; charset=utf-8"` → `"application/json"`. */
export function mediaType(header: string | undefined): string {
  if (!header) return '';
  let base = MEDIA_TYPES.get(header);
  if (base === undefined) {
    base = header.split(';', 1)[0]!.trim().toLowerCase();
    // Memoizado com limite: os tipos vêm da configuração e dos handlers (baixa cardinalidade), mas um
    // Content-Type montado com dado do cliente não pode fazer o mapa crescer sem fim.
    if (MEDIA_TYPES.size < 256) MEDIA_TYPES.set(header, base);
  }
  return base;
}
const MEDIA_TYPES = new Map<string, string>();

/**
 * Escolhe, entre os tipos `available` (em ordem de preferência do servidor), o melhor para o
 * header `Accept` (F-31). Respeita q-values e curingas (`text/*`, `*\/*`). Sem `Accept`,
 * devolve o primeiro. Retorna `undefined` quando nenhum é aceitável (→ 406).
 */
export function negotiate(accept: string | undefined, available: readonly string[]): string | undefined {
  if (!accept?.trim()) return available[0];
  const ranges = accept
    .split(',')
    .map((part, index) => {
      const [range = '', ...params] = part.trim().toLowerCase().split(';');
      const q = Number(
        params
          .map((p) => p.trim())
          .find((p) => p.startsWith('q='))
          ?.slice(2) ?? '1',
      );
      return { range: range.trim(), q: Number.isFinite(q) ? q : 1, index };
    })
    .filter((r) => r.range && r.q > 0)
    .sort((a, b) => b.q - a.q || specificity(b.range) - specificity(a.range) || a.index - b.index);

  for (const { range } of ranges) {
    const match = available.find((type) => matches(range, mediaType(type)));
    if (match) return match;
  }
  return undefined;
}

function specificity(range: string): number {
  if (range === '*/*') return 0;
  return range.endsWith('/*') ? 1 : 2;
}

function matches(range: string, type: string): boolean {
  if (range === '*/*' || range === type) return true;
  return range.endsWith('/*') && type.startsWith(range.slice(0, -1));
}

/** Acrescenta `charset=utf-8` a tipos textuais sem charset. */
export function withCharset(type: string): string {
  let out = WITH_CHARSET.get(type);
  if (out === undefined) {
    if (/;\s*charset=/i.test(type)) out = type;
    else {
      const base = mediaType(type);
      const textual = base.startsWith('text/') || isJsonContentType(base) || /\+xml$|\/xml$|yaml$/.test(base);
      out = textual ? `${type}; charset=utf-8` : type;
    }
    if (WITH_CHARSET.size < 256) WITH_CHARSET.set(type, out);
  }
  return out;
}
const WITH_CHARSET = new Map<string, string>();

/** `application/json` ou `application/*+json`, com parâmetros opcionais (B-11). */
export function isJsonContentType(header: string | undefined): boolean {
  const type = mediaType(header);
  return type === 'application/json' || /^application\/[a-z0-9!#$&^_.-]+\+json$/.test(type);
}

/**
 * Leitura e escrita de cookies (RFC 6265), seguras por padrão.
 *
 * - **Leitura:** o resultado é um objeto sem protótipo (`__proto__` vira um cookie comum, sem poluir
 *   nada); em nomes repetidos vale o primeiro, como nos navegadores; um valor com `%` inválido fica cru.
 * - **Escrita:** `HttpOnly`, `Secure`, `SameSite=Lax` e `Path=/` por padrão. Nome, `Domain` e `Path`
 *   são validados (sem `;`, quebra de linha nem caracteres de controle), então não dá para injetar
 *   atributos. O valor é codificado com `encodeURIComponent`.
 * - **Prefixos:** `__Host-` exige `Secure`, `Path=/` e nenhum `Domain`; `__Secure-` exige `Secure`.
 *   `SameSite=None` exige `Secure`. Violações lançam erro na hora de definir o cookie.
 */

export interface CookieOptions {
  /** Padrão: `true`. Impede a leitura por JavaScript no navegador. */
  httpOnly?: boolean;
  /** Padrão: `true`. Os navegadores aceitam cookies `Secure` em `http://localhost`. */
  secure?: boolean;
  /** Padrão: `'Lax'`. `'None'` exige `secure`. */
  sameSite?: 'Strict' | 'Lax' | 'None' | false;
  /** Padrão: `'/'`. */
  path?: string;
  /** Sem `domain`, o cookie vale só para o host atual (o mais restrito). */
  domain?: string;
  /** Duração em segundos. `0` remove o cookie. */
  maxAge?: number;
  expires?: Date;
  /** Cookie particionado (CHIPS), para uso em iframes de terceiros. Exige `secure`. */
  partitioned?: boolean;
  priority?: 'Low' | 'Medium' | 'High';
}

/** `token` da RFC 7230: o que um nome de cookie pode conter. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** Domain e Path: nada de `;`, controle (inclui CR/LF) nem DEL. */
const ATTR_VALUE = /^[^\x00-\x1f\x7f;]*$/;

/** Lê o header `Cookie` num objeto sem protótipo. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[name] = safeDecode(value);
  }
  return out;
}

function safeDecode(value: string): string {
  if (!value.includes('%')) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Monta o valor de um header `Set-Cookie`, aplicando os padrões seguros. */
export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  if (!TOKEN.test(name)) throw new Error(`[sashiko] invalid cookie name "${name}".`);

  const httpOnly = opts.httpOnly ?? true;
  const secure = opts.secure ?? true;
  const sameSite = opts.sameSite ?? 'Lax';
  const path = opts.path ?? '/';

  if (!ATTR_VALUE.test(path)) throw new Error(`[sashiko] invalid cookie path "${path}".`);
  if (opts.domain !== undefined && (!opts.domain || !ATTR_VALUE.test(opts.domain))) {
    throw new Error(`[sashiko] invalid cookie domain "${opts.domain}".`);
  }
  if (sameSite === 'None' && !secure) throw new Error(`[sashiko] cookie "${name}": SameSite=None requires secure.`);
  if (opts.partitioned && !secure) throw new Error(`[sashiko] cookie "${name}": partitioned requires secure.`);
  if (name.startsWith('__Secure-') && !secure) throw new Error(`[sashiko] cookie "${name}": the __Secure- prefix requires secure.`);
  if (name.startsWith('__Host-') && (!secure || path !== '/' || opts.domain !== undefined)) {
    throw new Error(`[sashiko] cookie "${name}": the __Host- prefix requires secure, path "/" and no domain.`);
  }

  let out = `${name}=${encodeURIComponent(value)}`;
  if (opts.maxAge !== undefined) {
    if (!Number.isFinite(opts.maxAge)) throw new Error(`[sashiko] cookie "${name}": invalid maxAge.`);
    out += `; Max-Age=${Math.floor(opts.maxAge)}`;
  }
  if (opts.expires) {
    if (Number.isNaN(opts.expires.getTime())) throw new Error(`[sashiko] cookie "${name}": invalid expires.`);
    out += `; Expires=${opts.expires.toUTCString()}`;
  }
  if (opts.domain !== undefined) out += `; Domain=${opts.domain}`;
  out += `; Path=${path}`;
  if (httpOnly) out += '; HttpOnly';
  if (secure) out += '; Secure';
  if (sameSite) out += `; SameSite=${sameSite}`;
  if (opts.partitioned) out += '; Partitioned';
  if (opts.priority) out += `; Priority=${opts.priority}`;
  return out;
}

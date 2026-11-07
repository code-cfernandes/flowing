/** `host[:port]`: nome (letras, dígitos, `.` e `-`) ou IPv6 entre colchetes, com porta opcional. */
const VALID_HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]{2,45}\])(?::\d{1,5})?$/;

/** Valida um valor de header `Host`/`X-Forwarded-Host` (S-09). */
export function isValidHost(value: string | undefined): value is string {
  return typeof value === 'string' && VALID_HOST.test(value);
}

/** `host` sem a porta: `api.exemplo.com:8080` → `api.exemplo.com`, `[::1]:3000` → `[::1]`. */
export function hostnameOf(host: string): string {
  return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!;
}

/**
 * Extrai path e query do request-target **sem** deixar o cliente escolher o host (S-09).
 *
 * - `//evil.com/x` continua sendo o path `//evil.com/x`; não vira uma URL relativa ao protocolo.
 * - `http://outro/x` (absolute-form, usado por proxies) só tem o path e a query aproveitados.
 * - Segmentos `.` e `..` são normalizados como no WHATWG URL.
 */
export function parseRequestTarget(raw: string | undefined): URL {
  let target = raw || '/';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
    try {
      const abs = new URL(target);
      target = abs.pathname + abs.search;
    } catch {
      target = '/';
    }
  }
  if (!target.startsWith('/')) target = `/${target}`;
  // Base fixa concatenada (e não como segundo argumento): `//x` nunca é lido como host.
  return new URL(`http://localhost${target}`);
}

/** Path e query do request-target, como strings (`search` inclui o `?`, ou é `''`). */
export interface RequestTarget {
  pathname: string;
  search: string;
}

/**
 * Caracteres de path que o WHATWG URL mantém exatamente como estão. Ficam de fora, e vão para o
 * caminho completo com `URL`: `%` (decodificação), `\\` (vira `/`), aspas, espaços, `#`, `<`, `>`,
 * `{`, `}`, `^`, `|`, `` ` `` e não-ASCII.
 */
const SIMPLE_PATH = /^\/[A-Za-z0-9\-._~/:@!$&()*+,;=]*$/;
/** Query com caracteres que o URL não reescreve (sem `'`, que ele codifica em URLs especiais). */
const SIMPLE_QUERY = /^[A-Za-z0-9\-._~/:@!$&()*+,;=?%]*$/;
/** `//`, ou um segmento `.`/`..`: o URL normalizaria, então vai para o caminho completo. */
const NEEDS_NORMALIZATION = /\/\/|(?:^|\/)\.\.?(?:\/|$)/;

/**
 * O mesmo resultado de {@link parseRequestTarget} (S-09), sem criar um objeto `URL` no caso comum
 * (F-41): para um path simples, já normalizado, o URL não mudaria nada, e basta cortar a string no `?`.
 * Qualquer outro caso (absolute-form, `%`, `\\`, `//`, segmentos `.`/`..`, caracteres especiais) usa o
 * caminho completo, com exatamente o comportamento de antes.
 */
export function splitRequestTarget(raw: string | undefined): RequestTarget {
  const target = raw || '/';
  const q = target.indexOf('?');
  const path = q === -1 ? target : target.slice(0, q);
  const query = q === -1 ? '' : target.slice(q + 1);
  if (SIMPLE_PATH.test(path) && !NEEDS_NORMALIZATION.test(path) && SIMPLE_QUERY.test(query)) {
    // O URL descarta o `?` final sem query (`/a?` → search `''`).
    return { pathname: path, search: query ? `?${query}` : '' };
  }
  const url = parseRequestTarget(raw);
  return { pathname: url.pathname, search: url.search };
}

/**
 * Escolhe o valor de um header encaminhado (`X-Forwarded-For`, `-Host`, `-Proto`) segundo `trustProxy`:
 * - `true`: confia em toda a cadeia e usa o primeiro valor (o cliente original);
 * - `n` (número): confia em `n` proxies e usa o valor adicionado pelo mais externo deles.
 */
export function pickForwarded(header: string | string[] | undefined, trust: boolean | number): string | undefined {
  if (!trust || header === undefined) return undefined;
  const list = (Array.isArray(header) ? header.join(',') : header)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (list.length === 0) return undefined;
  if (trust === true) return list[0];
  return list[Math.max(0, list.length - trust)];
}

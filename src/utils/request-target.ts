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

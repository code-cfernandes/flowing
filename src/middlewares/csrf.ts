import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Middleware } from '../core/compose.ts';
import type { Context } from '../core/context.ts';
import { HttpError } from '../core/errors.ts';
import { serializeCookie, type CookieOptions } from '../utils/cookie.ts';
import { compileOriginMatcher, normalizeOrigin, type MatchRule } from '../utils/origin-match.ts';

declare module '../core/context.ts' {
  interface ContextState {
    /** Token CSRF da requisição, com `csrf({ token: true })`. Envie-o ao front no header configurado. */
    csrfToken?: string;
  }
}

export interface CsrfTokenOptions {
  /** Padrão: `'__Host-csrf'`, que não pode ser definido por subdomínios. */
  cookieName?: string;
  /** Header onde o cliente devolve o token. Padrão: `'X-CSRF-Token'`. */
  headerName?: string;
  /** Atributos do cookie. `httpOnly` é sempre `false` (o front precisa ler) e `SameSite` padrão é `Strict`. */
  cookie?: Omit<CookieOptions, 'httpOnly'>;
}

export interface CsrfOptions {
  /**
   * Outras origens confiáveis além da própria (`ctx.protocol://ctx.host`), com as mesmas regras do
   * `cors()`: `'https://app.exemplo.com'`, `'https://*.exemplo.dev'` ou RegExp de casamento inteiro.
   */
  trustedOrigins?: readonly MatchRule[];
  /** Ativa também o double-submit token. `true` usa os padrões de {@link CsrfTokenOptions}. */
  token?: boolean | CsrfTokenOptions;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Proteção contra CSRF. Use sempre que a autenticação for por cookie.
 *
 * Métodos que alteram estado (todos menos GET, HEAD e OPTIONS) são recusados com 403 quando vêm de
 * outra origem:
 * 1. `Sec-Fetch-Site: same-origin` ou `none` (navegação do próprio usuário) passa; `same-site` e
 *    `cross-site` só passam se o `Origin` estiver em `trustedOrigins`;
 * 2. sem `Sec-Fetch-Site`, o `Origin` precisa ser a própria origem ou uma confiável;
 * 3. sem nenhum dos dois, a requisição não veio de um navegador (curl, servidor a servidor) e passa,
 *    porque CSRF depende de um navegador que anexe os cookies da vítima.
 *
 * Com `token`, além disso, exige o double-submit: o valor do header deve ser igual ao do cookie.
 * Por isso, rotas GET nunca devem alterar estado.
 */
export function csrf(opts: CsrfOptions = {}): Middleware {
  const trusted = compileOriginMatcher(opts.trustedOrigins ?? []);
  const token = opts.token ? (opts.token === true ? {} : opts.token) : undefined;
  const cookieName = token?.cookieName ?? '__Host-csrf';
  const headerName = (token?.headerName ?? 'X-CSRF-Token').toLowerCase();
  const cookieOpts: CookieOptions = { sameSite: 'Strict', ...token?.cookie, httpOnly: false };
  // Valida nome e atributos já na criação, e não na primeira requisição.
  if (token) serializeCookie(cookieName, 'x', cookieOpts);

  return async (ctx, next) => {
    const safe = SAFE_METHODS.has(ctx.method);
    if (!safe && !originAllowed(ctx, trusted)) {
      throw new HttpError(403, 'Cross-origin request blocked', 'CSRF_ORIGIN');
    }

    if (token) {
      const current = ctx.cookies[cookieName];
      if (!safe) {
        const sent = ctx.get(headerName);
        if (!current || !sent || !equal(current, sent)) {
          throw new HttpError(403, 'Invalid CSRF token', 'CSRF_TOKEN');
        }
      }
      if (current && current.length >= 32) {
        ctx.state.csrfToken = current;
      } else {
        ctx.state.csrfToken = randomBytes(32).toString('base64url');
        ctx.setCookie(cookieName, ctx.state.csrfToken, cookieOpts);
      }
    }
    await next();
  };
}

function originAllowed(ctx: Context, trusted: (origin: string) => boolean): boolean {
  const origin = ctx.get('origin');
  const site = ctx.get('sec-fetch-site');
  if (site === 'same-origin' || site === 'none') return true;
  if (site !== undefined) return origin !== undefined && trusted(origin);
  if (origin === undefined) return true;
  const own = ctx.host ? normalizeOrigin(`${ctx.protocol}://${ctx.host}`) : undefined;
  return (own !== undefined && normalizeOrigin(origin) === own) || trusted(origin);
}

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

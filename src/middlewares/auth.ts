import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context } from '../core/context.ts';
import { HttpError } from '../core/errors.ts';
import type { Guard } from '../core/guard.ts';

/**
 * Compara dois segredos em tempo constante (S-10). Os dois lados passam por SHA-256 antes, então o
 * tempo também não revela o tamanho do segredo esperado.
 */
export function safeEqual(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y) && a.length === b.length;
}

/** O que o `verify` devolve: o usuário autenticado (vai para `ctx.state.user`), ou `false`/`undefined` para recusar. */
type Verified<U> = U | false | null | undefined;

export interface BearerAuthOptions<U> {
  /**
   * Confere o token e devolve o usuário (ou `true`). A verificação é sua: JWT com a biblioteca da
   * sua escolha, consulta ao banco, lista de chaves comparadas com {@link safeEqual}…
   */
  verify: (token: string, ctx: Context) => Verified<U> | Promise<Verified<U>>;
  /** Vai no `WWW-Authenticate` do 401. Padrão: `'api'`. */
  realm?: string;
}

export interface BasicAuthOptions<U> {
  /** Confere usuário e senha (compare com {@link safeEqual}) e devolve o usuário (ou `true`). */
  verify: (username: string, password: string, ctx: Context) => Verified<U> | Promise<Verified<U>>;
  /** Padrão: `'api'`. */
  realm?: string;
}

const quote = (realm: string) => `"${realm.replace(/["\\\r\n]/g, '')}"`;

/** 401 padronizado: a mesma resposta para credencial ausente, malformada ou inválida, sem revelar o motivo. */
function deny(ctx: Context, scheme: 'Bearer' | 'Basic', realm: string): never {
  ctx.res.setHeader('WWW-Authenticate', `${scheme} realm=${quote(realm)}${scheme === 'Basic' ? ', charset="UTF-8"' : ''}`);
  throw new HttpError(401, 'Unauthorized', 'UNAUTHORIZED');
}

function credentials(ctx: Context, scheme: string): string | undefined {
  const header = ctx.get('authorization');
  if (!header) return undefined;
  const space = header.indexOf(' ');
  if (space === -1 || header.slice(0, space).toLowerCase() !== scheme.toLowerCase()) return undefined;
  return header.slice(space + 1).trim() || undefined;
}

function accept<U>(ctx: Context, user: Verified<U>): boolean {
  if (user === true) return true;
  (ctx.state as Record<string, unknown>).user = user;
  return true;
}

/**
 * Guard de `Authorization: Bearer <token>` (S-10). Sem token, ou com token recusado, responde 401 com
 * `WWW-Authenticate`. O usuário devolvido pelo `verify` fica em `ctx.state.user`.
 *
 * ```ts
 * const auth = bearerAuth({ verify: (token) => sessions.get(token) });
 * app.group({ guards: [auth] }, (g) => g.mount(UserRoutes));
 * ```
 */
export function bearerAuth<U>(opts: BearerAuthOptions<U>): Guard {
  const realm = opts.realm ?? 'api';
  return async (ctx) => {
    const token = credentials(ctx, 'Bearer');
    if (!token) deny(ctx, 'Bearer', realm);
    const user = await opts.verify(token, ctx);
    if (user === false || user === null || user === undefined) deny(ctx, 'Bearer', realm);
    return accept(ctx, user);
  };
}

/**
 * Guard de `Authorization: Basic` (S-10), para painéis internos e integrações simples. Use só sobre
 * HTTPS: a senha vai em base64, que não é criptografia.
 */
export function basicAuth<U>(opts: BasicAuthOptions<U>): Guard {
  const realm = opts.realm ?? 'api';
  return async (ctx) => {
    const encoded = credentials(ctx, 'Basic');
    if (!encoded) deny(ctx, 'Basic', realm);
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon === -1) deny(ctx, 'Basic', realm);
    const user = await opts.verify(decoded.slice(0, colon), decoded.slice(colon + 1), ctx);
    if (user === false || user === null || user === undefined) deny(ctx, 'Basic', realm);
    return accept(ctx, user);
  };
}

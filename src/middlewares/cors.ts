import type { Middleware } from '../core/compose.ts';
import { compileOriginMatcher } from '../utils/origin-match.ts';

export type CorsOrigin =
  | '*'
  | string
  | RegExp
  | readonly (string | RegExp)[]
  | ((origin: string) => boolean | Promise<boolean>);

export interface CorsOptions {
  /**
   * Origens permitidas. Obrigatório: não existe default permissivo.
   * - `'https://app.exemplo.com'`: igualdade exata depois de normalizar (esquema, host e porta);
   * - `'https://*.exemplo.dev'`: só subdomínios, nunca o domínio em si nem `exemplo.dev.atacante.com`;
   * - RegExp: precisa casar a origem **inteira** (como se tivesse `^…$`); prefira o curinga;
   * - função: lógica própria, sob sua responsabilidade.
   */
  origin: CorsOrigin;
  methods?: readonly string[];
  allowedHeaders?: readonly string[];
  exposedHeaders?: readonly string[];
  /** Envia `Access-Control-Allow-Credentials: true`. Proibido com `origin: '*'`. */
  credentials?: boolean;
  /** Cache do preflight em segundos. Padrão: 600. */
  maxAge?: number;
}

const DEFAULT_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
const DEFAULT_HEADERS = ['Content-Type', 'Authorization'];

/**
 * Middleware de CORS (S-01). Uso: `app.use(cors({ origin: 'https://app.exemplo.com' }))`.
 *
 * - Preflight (`OPTIONS` + `Access-Control-Request-Method`) é respondido com 204.
 * - A origem só é refletida se estiver na lista permitida; `Vary: Origin` sempre que
 *   a resposta depende da origem.
 * - `origin: '*'` + `credentials: true` é rejeitado na criação (o navegador também recusaria,
 *   e refletir qualquer origem com credenciais permitiria que qualquer site lesse dados do usuário).
 */
export function cors(opts: CorsOptions): Middleware {
  if (opts.origin === '*' && opts.credentials) {
    throw new Error("cors: `origin: '*'` cannot be combined with `credentials: true`. List the allowed origins.");
  }
  const wildcard = opts.origin === '*';
  // `'*'` não passa pelo compilador de regras: é o modo "qualquer origem", tratado à parte.
  const isAllowed = wildcard ? () => true : buildMatcher(opts.origin);
  const methods = (opts.methods ?? DEFAULT_METHODS).join(', ');
  const allowedHeaders = opts.allowedHeaders?.join(', ');
  const exposed = opts.exposedHeaders?.join(', ');
  const maxAge = String(opts.maxAge ?? 600);

  return async (ctx, next) => {
    const origin = ctx.req.headers.origin;
    const res = ctx.res;
    if (!wildcard) res.appendHeader('Vary', 'Origin');

    const preflight = ctx.method === 'OPTIONS' && ctx.req.headers['access-control-request-method'] !== undefined;

    if (!origin) return preflight ? void ctx.status(204).res.end() : next();

    const allowed = wildcard || (await isAllowed(origin));
    if (!allowed) {
      // Sem headers CORS o navegador bloqueia a leitura; a requisição em si segue normalmente.
      return preflight ? void ctx.status(204).res.end() : next();
    }

    res.setHeader('Access-Control-Allow-Origin', wildcard ? '*' : origin);
    if (opts.credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (preflight) {
      res.setHeader('Access-Control-Allow-Methods', methods);
      const requested = ctx.req.headers['access-control-request-headers'];
      const headers = allowedHeaders ?? (typeof requested === 'string' ? filterHeaders(requested) : DEFAULT_HEADERS.join(', '));
      if (headers) res.setHeader('Access-Control-Allow-Headers', headers);
      res.setHeader('Access-Control-Max-Age', maxAge);
      return void ctx.status(204).res.end();
    }

    if (exposed) res.setHeader('Access-Control-Expose-Headers', exposed);
    await next();
  };
}

/** Sem lista explícita, aceita apenas os headers padrão entre os pedidos pelo navegador. */
function filterHeaders(requested: string): string {
  const safe = new Set(DEFAULT_HEADERS.map((h) => h.toLowerCase()));
  return requested.split(',').map((h) => h.trim()).filter((h) => safe.has(h.toLowerCase())).join(', ');
}

function buildMatcher(origin: CorsOrigin): (o: string) => boolean | Promise<boolean> {
  if (typeof origin === 'function') return origin;
  const list = Array.isArray(origin) ? origin : [origin as string | RegExp];
  return compileOriginMatcher(list);
}

import type { ServerResponse } from 'node:http';

export interface SecurityHeadersOptions {
  /** Padrão: `default-src 'none'; frame-ancestors 'none'` (adequado para APIs JSON). `false` desliga. */
  contentSecurityPolicy?: string | false;
  /** Padrão: `no-referrer`. */
  referrerPolicy?: string | false;
  /** Padrão: `DENY`. */
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  /** Padrão: `same-origin`. */
  crossOriginResourcePolicy?: 'same-origin' | 'same-site' | 'cross-origin' | false;
  /**
   * HSTS é opt-in: só faz sentido atrás de HTTPS.
   * `true` = `max-age=15552000; includeSubDomains` (180 dias).
   */
  strictTransportSecurity?: boolean | { maxAge: number; includeSubDomains?: boolean; preload?: boolean };
}

/** `'api'`: restritivo, para APIs (padrão). `'web'`: permite recursos do próprio site (F-31). */
export type SecurityPreset = 'api' | 'web';

const PRESETS: Record<SecurityPreset, SecurityHeadersOptions> = {
  api: {},
  web: {
    contentSecurityPolicy: "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
    frameOptions: 'SAMEORIGIN',
  },
};

/**
 * Headers de segurança padrão (S-04) e proteções contra XSS (S-02).
 * Retorna uma função que aplica os headers pré-calculados na resposta.
 */
export function buildSecurityHeaders(input: SecurityHeadersOptions | SecurityPreset = {}): (res: ServerResponse) => void {
  const opts = typeof input === 'string' ? PRESETS[input] : input;
  const headers: [string, string][] = [['X-Content-Type-Options', 'nosniff']];

  const csp = opts.contentSecurityPolicy ?? "default-src 'none'; frame-ancestors 'none'";
  if (csp) headers.push(['Content-Security-Policy', csp]);

  const referrer = opts.referrerPolicy ?? 'no-referrer';
  if (referrer) headers.push(['Referrer-Policy', referrer]);

  const frame = opts.frameOptions ?? 'DENY';
  if (frame) headers.push(['X-Frame-Options', frame]);

  const corp = opts.crossOriginResourcePolicy ?? 'same-origin';
  if (corp) headers.push(['Cross-Origin-Resource-Policy', corp]);

  const hsts = opts.strictTransportSecurity;
  if (hsts) {
    const cfg = hsts === true ? { maxAge: 15552000, includeSubDomains: true } : hsts;
    let value = `max-age=${cfg.maxAge}`;
    if (cfg.includeSubDomains) value += '; includeSubDomains';
    if ('preload' in cfg && cfg.preload) value += '; preload';
    headers.push(['Strict-Transport-Security', value]);
  }

  return (res) => {
    for (const [name, value] of headers) res.setHeader(name, value);
  };
}

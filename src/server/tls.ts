import type { SecureContext, SecureContextOptions } from 'node:tls';
import { createSecureContext } from 'node:tls';

/** Material de um certificado: PEM (`key` + `cert`) ou PKCS#12 (`pfx`). */
export interface TlsCertificate {
  key?: string | Buffer | (string | Buffer)[];
  cert?: string | Buffer | (string | Buffer)[];
  pfx?: string | Buffer;
  /** Senha da chave ou do `pfx`. */
  passphrase?: string;
  /** CAs intermediárias, se não estiverem no `cert` (fullchain). */
  ca?: string | Buffer | (string | Buffer)[];
}

/**
 * HTTPS no `app.listen({ tls })`. TLS 1.2 é o mínimo; SSLv3, TLS 1.0 e 1.1 não são aceitos.
 *
 * ```ts
 * await app.listen({ port: 443, host: '0.0.0.0', tls: { key, cert } });
 * ```
 */
export interface TlsOptions extends TlsCertificate {
  /** Padrão: `'TLSv1.2'`. */
  minVersion?: 'TLSv1.2' | 'TLSv1.3';
  /**
   * Certificados por domínio (SNI), escolhidos no handshake: `{ 'api.exemplo.com': { key, cert } }`.
   * `'*.exemplo.dev'` vale para um nível de subdomínio, como no próprio certificado. Um domínio sem
   * entrada usa o certificado principal (`key`/`cert`/`pfx`); sem ele, o handshake é recusado.
   */
  sni?: Record<string, TlsCertificate>;
}

const ALLOWED_MIN = new Set(['TLSv1.2', 'TLSv1.3']);

function contextOptions(cert: TlsCertificate, minVersion: string): SecureContextOptions {
  return { ...cert, minVersion: minVersion as SecureContextOptions['minVersion'] };
}

const hasCert = (c: TlsCertificate) => (c.key !== undefined && c.cert !== undefined) || c.pfx !== undefined;

/** O que o servidor HTTPS precisa: opções do certificado principal e o `SNICallback`. */
export interface CompiledTls {
  options: SecureContextOptions & { SNICallback?: (servername: string, cb: (err: Error | null, ctx?: SecureContext) => void) => void };
  /** Contexto do certificado principal, para `setSecureContext()` na troca. */
  main: SecureContextOptions | undefined;
}

/**
 * Valida a configuração e cria os contextos (os certificados são lidos e conferidos aqui, então um PEM
 * inválido falha no `listen()`, e não no primeiro cliente).
 */
export function compileTls(tls: TlsOptions, lookup?: { current: SniTable }): CompiledTls {
  const minVersion = tls.minVersion ?? 'TLSv1.2';
  if (!ALLOWED_MIN.has(minVersion)) {
    throw new Error(`[flowing] tls.minVersion must be 'TLSv1.2' or 'TLSv1.3' (got '${minVersion}').`);
  }
  const { sni, minVersion: _m, ...mainCert } = tls;
  const main = hasCert(mainCert) ? contextOptions(mainCert, minVersion) : undefined;
  if (!main && !sni) throw new Error('[flowing] tls needs a certificate: { key, cert }, { pfx } or { sni }.');
  if (main) createSecureContext(main); // valida já

  const table = buildSniTable(sni ?? {}, minVersion);
  if (lookup) lookup.current = table;
  const options: CompiledTls['options'] = { ...(main ?? { minVersion: minVersion as SecureContextOptions['minVersion'] }) };
  // Sempre instalado: assim um `reloadTLS()` com `sni` funciona mesmo que o `listen()` não tivesse `sni`.
  // Sem entrada para o domínio, devolve `undefined` e vale o certificado principal.
  const ref = lookup ?? { current: table };
  options.SNICallback = (servername, cb) => cb(null, ref.current.find(servername));
  return { options, main };
}

/** Tabela de contextos por domínio: igualdade exata primeiro, depois o curinga de um nível. */
export interface SniTable {
  find(servername: string): SecureContext | undefined;
}

function buildSniTable(entries: Record<string, TlsCertificate>, minVersion: string): SniTable {
  const exact = new Map<string, SecureContext>();
  const wildcard = new Map<string, SecureContext>();
  for (const [rawName, cert] of Object.entries(entries)) {
    const name = rawName.toLowerCase();
    if (!hasCert(cert)) throw new Error(`[flowing] tls.sni["${rawName}"] needs { key, cert } or { pfx }.`);
    const valid = /^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+$/.test(name);
    if (!valid) throw new Error(`[flowing] tls.sni: invalid domain "${rawName}"; use "api.exemplo.com" or "*.exemplo.dev".`);
    const ctx = createSecureContext(contextOptions(cert, minVersion));
    if (name.startsWith('*.')) wildcard.set(name.slice(2), ctx);
    else exact.set(name, ctx);
  }
  return {
    find(servername) {
      const name = servername.toLowerCase().replace(/\.$/, '');
      const hit = exact.get(name);
      if (hit) return hit;
      const dot = name.indexOf('.');
      // `*.exemplo.dev` cobre `a.exemplo.dev`, mas não `a.b.exemplo.dev` nem `exemplo.dev`.
      return dot > 0 ? wildcard.get(name.slice(dot + 1)) : undefined;
    },
  };
}

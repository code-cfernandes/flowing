/**
 * Comparação de origens (CORS) e hosts (`allowedHosts`) segura por padrão.
 *
 * O risco não está no volume de código, e sim na semântica da comparação. Por isso:
 * - **strings** são normalizadas com o parser nativo de URL e comparadas por igualdade, nunca por substring;
 * - **curinga** (`https://*.exemplo.dev`, `*.exemplo.dev`) aceita só subdomínios, nunca o domínio
 *   em si nem `exemplo.dev.atacante.com`;
 * - **RegExp** precisa casar a string **inteira**, como se tivesse `^…$`, mesmo que o autor esqueça as
 *   âncoras. As flags `g`, `y` e `m` são descartadas, então `lastIndex` e `^`/`$` por linha não interferem.
 *
 * Erros de configuração (string sem esquema, curinga mal posicionado) são lançados na criação do
 * middleware ou do app, e não na primeira requisição.
 */

export type MatchRule = string | RegExp;

/** Envolve a RegExp para casar a string inteira e descarta flags com estado ou por linha. */
export function toFullMatch(rule: RegExp): RegExp {
  return new RegExp(`^(?:${rule.source})$`, rule.flags.replace(/[gym]/g, ''));
}

/** `https://*.exemplo.dev` → `{ scheme: 'https:', suffix: '.exemplo.dev', port: '' }`. */
interface WildcardOrigin {
  protocol: string;
  suffix: string;
  port: string;
}

/** Normaliza uma origem (`Https://App.Exemplo.com:443/` → `https://app.exemplo.com`), ou `undefined` se inválida. */
export function normalizeOrigin(value: string): string | undefined {
  if (value === 'null') return 'null';
  try {
    const url = new URL(value);
    if (url.origin === 'null') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function parseWildcardOrigin(rule: string): WildcardOrigin {
  const match = /^([a-z][a-z0-9+.-]*:)\/\/\*\.([^/:]+)(?::(\d+))?\/?$/i.exec(rule);
  if (!match) {
    throw new Error(`[flowing] invalid origin rule "${rule}": "*" is only allowed as the first label, e.g. "https://*.exemplo.dev".`);
  }
  const [, protocol, domain, port = ''] = match;
  // Normaliza o domínio (maiúsculas, IDN → punycode) e a porta padrão do esquema.
  const url = new URL(`${protocol}//x.${domain}${port ? `:${port}` : ''}`);
  return { protocol: url.protocol, suffix: url.hostname.slice(1), port: url.port };
}

/**
 * Compila as regras de origem do CORS. Strings precisam do esquema (`https://app.exemplo.com`);
 * `'null'` só casa com a origem `null` se estiver listada explicitamente.
 */
export function compileOriginMatcher(rules: readonly MatchRule[]): (origin: string) => boolean {
  const exact = new Set<string>();
  const wildcards: WildcardOrigin[] = [];
  const patterns: RegExp[] = [];

  for (const rule of rules) {
    if (rule instanceof RegExp) {
      patterns.push(toFullMatch(rule));
      continue;
    }
    if (rule === '*') {
      throw new Error(`[flowing] cors: "*" inside a list is not allowed; use origin: '*' to allow any origin.`);
    }
    if (rule.includes('*')) {
      wildcards.push(parseWildcardOrigin(rule));
      continue;
    }
    const normalized = normalizeOrigin(rule);
    if (!normalized) {
      throw new Error(`[flowing] invalid origin rule "${rule}": use the full origin with scheme, e.g. "https://app.exemplo.com".`);
    }
    exact.add(normalized);
  }

  return (origin) => {
    const normalized = normalizeOrigin(origin);
    if (!normalized) return false;
    if (exact.has(normalized)) return true;
    if (normalized !== 'null' && wildcards.length > 0) {
      const url = new URL(normalized);
      const matched = wildcards.some(
        (w) =>
          w.protocol === url.protocol && w.port === url.port && url.hostname.endsWith(w.suffix) && url.hostname.length > w.suffix.length,
      );
      if (matched) return true;
    }
    return patterns.some((re) => re.test(normalized));
  };
}

/** Normaliza um host de regra (`API.Exemplo.com:8443` → `api.exemplo.com:8443`; IDN → punycode). */
function normalizeHostRule(rule: string): { hostname: string } {
  try {
    const url = new URL(`http://${rule}`);
    if (url.pathname !== '/' || url.search || url.username) throw new Error('not a host');
    return { hostname: url.hostname };
  } catch {
    throw new Error(`[flowing] invalid allowedHosts rule "${rule}": use a host like "api.exemplo.com" or "*.exemplo.dev".`);
  }
}

/**
 * Compila `allowedHosts`. Strings casam com o hostname ou com `host:porta`; `*.exemplo.dev` aceita só
 * subdomínios; RegExp precisa casar o hostname inteiro.
 */
export function compileHostMatcher(rules: readonly MatchRule[]): (hostname: string, host: string) => boolean {
  const exact = new Set<string>();
  const suffixes: string[] = [];
  const patterns: RegExp[] = [];

  for (const rule of rules) {
    if (rule instanceof RegExp) {
      patterns.push(toFullMatch(rule));
    } else if (rule.startsWith('*.')) {
      suffixes.push(`.${normalizeHostRule(rule.slice(2)).hostname}`);
    } else if (rule.includes('*')) {
      throw new Error(`[flowing] invalid allowedHosts rule "${rule}": "*" is only allowed as "*.domain".`);
    } else {
      const { hostname } = normalizeHostRule(rule);
      // Com porta, a regra exige a porta exata (mesmo a padrão); sem porta, aceita qualquer uma.
      exact.add(rule.includes(':') ? rule.toLowerCase() : hostname);
    }
  }

  return (hostname, host) => {
    const h = hostname.toLowerCase();
    const full = host.toLowerCase();
    if (exact.has(h) || exact.has(full)) return true;
    if (suffixes.some((s) => h.endsWith(s) && h.length > s.length)) return true;
    return patterns.some((re) => re.test(h));
  };
}

/** Regra de host de uma rota (virtual host), já compilada. */
export interface RouteHostRule {
  /** Como foi escrita, para mensagens. */
  label: string;
  kind: 'exact' | 'wildcard' | 'regex';
  /** Hostname (exato) ou domínio base (curinga); vazio em RegExp. */
  base: string;
  /** Chave da restrição no roteador: `api.exemplo.com`, `*.exemplo.dev` ou `re:/…/flags`. */
  key: string;
  test(hostname: string): boolean;
}

/**
 * Compila a regra de host de `mount(X, { host })`/`group({ host })` (F-35), com as mesmas regras do
 * `allowedHosts`: string exata (sem porta), `*.dominio` para subdomínios de qualquer profundidade (nunca o
 * domínio em si), RegExp com casamento da string inteira.
 */
export function compileRouteHost(rule: MatchRule): RouteHostRule {
  if (rule instanceof RegExp) {
    const re = toFullMatch(rule);
    return { label: String(rule), kind: 'regex', base: '', key: `re:${re.source}/${re.flags}`, test: (h) => re.test(h) };
  }
  if (rule.startsWith('*.')) {
    const base = normalizeHostRule(rule.slice(2)).hostname;
    const suffix = `.${base}`;
    return { label: rule, kind: 'wildcard', base, key: `*.${base}`, test: (h) => h.endsWith(suffix) && h.length > suffix.length };
  }
  if (rule.includes('*')) throw new Error(`[flowing] invalid host rule "${rule}": "*" is only allowed as "*.domain".`);
  if (rule.includes(':')) throw new Error(`[flowing] invalid host rule "${rule}": use the hostname without the port.`);
  const { hostname } = normalizeHostRule(rule);
  return { label: rule, kind: 'exact', base: hostname, key: hostname, test: (h) => h === hostname };
}

/**
 * Prioridade entre regras que casam com o mesmo host (F-35), usada **igual** pelo roteador e pelo OpenAPI:
 * exato → curinga mais específico (mais rótulos no domínio base) → RegExp, na ordem de registro.
 * Menor vence. Rotas sem host ficam por último (são o fallback).
 */
export function hostRank(rule: RouteHostRule, seq: number): number {
  if (rule.kind === 'exact') return 0;
  if (rule.kind === 'wildcard') return 1_000_000 - rule.base.split('.').length * 1_000 + Math.min(seq, 999);
  return 2_000_000 + seq;
}
export const NO_HOST_RANK = Number.MAX_SAFE_INTEGER;

/**
 * Uma regra de rota pode ser alcançada com este `allowedHosts`? (F-35)
 * `'yes'` quando há interseção comprovada, `'no'` quando comprovadamente não há, `'unknown'` com RegExp.
 */
export function hostReachability(rule: RouteHostRule, allowed: readonly MatchRule[]): 'yes' | 'no' | 'unknown' {
  if (rule.kind === 'regex') return 'unknown';
  let unknown = false;
  for (const a of allowed) {
    if (a instanceof RegExp) {
      if (rule.kind === 'exact' && toFullMatch(a).test(rule.base)) return 'yes';
      unknown = true;
      continue;
    }
    if (a.startsWith('*.')) {
      const c = normalizeHostRule(a.slice(2)).hostname;
      if (rule.kind === 'exact' && rule.base.endsWith(`.${c}`)) return 'yes';
      // Dois curingas se sobrepõem quando um domínio base está dentro do outro.
      if (rule.kind === 'wildcard' && (c === rule.base || c.endsWith(`.${rule.base}`) || rule.base.endsWith(`.${c}`))) return 'yes';
      continue;
    }
    const host = normalizeHostRule(a).hostname; // `api.exemplo.com:8443` → `api.exemplo.com`
    if (rule.test(host)) return 'yes';
  }
  return unknown ? 'unknown' : 'no';
}

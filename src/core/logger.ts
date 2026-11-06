/**
 * Contrato de logger compatível com o pino (F-06): `logger.info({ reqId }, 'mensagem')`.
 * Para usar o pino, basta passar a instância: `createApp({ logger: pino() })`.
 */
export interface Logger {
  debug(obj: object, msg?: string): void;
  debug(msg: string): void;
  info(obj: object, msg?: string): void;
  info(msg: string): void;
  warn(obj: object, msg?: string): void;
  warn(msg: string): void;
  error(obj: object, msg?: string): void;
  error(msg: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export interface ConsoleLoggerOptions {
  /** Padrão: `info`. */
  level?: LogLevel;
  /**
   * Chaves mascaradas como `[REDACTED]` em qualquer nível dos dados logados (S-11). Somadas às padrão
   * ({@link DEFAULT_REDACT_KEYS}); `false` desliga. A comparação ignora maiúsculas, `-` e `_`, então
   * `'apiKey'` também cobre `api_key` e `X-Api-Key`.
   */
  redact?: readonly string[] | false;
  /**
   * `'pretty'` (padrão): `[sashiko] mensagem { ...dados }`, para o terminal. `'json'`: uma linha JSON por
   * evento (`{ level, time, msg, ...dados }`), para coletores de log (Datadog, Loki, CloudWatch…).
   */
  format?: 'pretty' | 'json';
}

/** `JSON.stringify` que não falha: erros viram `{ type, message, stack }` e ciclos viram `[Circular]`. */
function toJsonLine(record: Record<string, unknown>): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(record, (_key, value: unknown) => {
    if (value instanceof Error) {
      const out: Record<string, unknown> = { type: value.name, message: value.message, stack: value.stack };
      for (const [k, v] of Object.entries(value)) out[k] = v;
      return out;
    }
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  });
}

/** Chaves mascaradas por padrão: credenciais, cookies e tokens. */
export const DEFAULT_REDACT_KEYS: readonly string[] = [
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key',
  'password', 'passwd', 'secret', 'client-secret', 'token', 'access-token', 'refresh-token', 'id-token',
];

const REDACTED = '[REDACTED]';
const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Cópia dos dados com as chaves sensíveis mascaradas. Erros, datas e buffers passam como estão. */
export function redactValue(value: unknown, keys: ReadonlySet<string>, seen = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value !== 'object' || value === null || depth > 10) return value;
  if (value instanceof Error || value instanceof Date || ArrayBuffer.isView(value)) return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, keys, seen, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = keys.has(normalizeKey(k)) ? REDACTED : redactValue(v, keys, seen, depth + 1);
  }
  return out;
}

/**
 * Logger padrão sobre o `console`, sem dependências. Formato: `[sashiko] mensagem { ...dados }`.
 * O core não registra headers nem body. O que você logar passa pelo `redact`: `authorization`,
 * `cookie`, `password`, `token` e afins saem como `[REDACTED]` (S-11).
 */
export function consoleLogger(opts: ConsoleLoggerOptions = {}, bindings: Record<string, unknown> = {}): Logger {
  const min = LEVELS[opts.level ?? 'info'];
  const keys = opts.redact === false ? undefined : new Set([...DEFAULT_REDACT_KEYS, ...(opts.redact ?? [])].map(normalizeKey));
  const emit = (level: Exclude<LogLevel, 'silent'>) => (objOrMsg: object | string, msg?: string) => {
    if (LEVELS[level] < min) return;
    const [data, text] = typeof objOrMsg === 'string' ? [{}, objOrMsg] : [objOrMsg, msg ?? ''];
    const merged = { ...bindings, ...data };
    const safe = (keys ? redactValue(merged, keys) : merged) as Record<string, unknown>;
    if (opts.format === 'json') {
      console[level](toJsonLine({ level, time: new Date().toISOString(), msg: text, ...safe }));
    } else {
      console[level](`[sashiko] ${text}`, safe);
    }
  };
  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    child: (extra) => consoleLogger(opts, { ...bindings, ...extra }),
  };
}

/** Logger que descarta tudo (`createApp({ logger: false })`). */
export const silentLogger: Logger = {
  debug() {}, info() {}, warn() {}, error() {},
  child: () => silentLogger,
};

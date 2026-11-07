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
  /**
   * Opcionais, para não exigir de loggers próprios (F-38): o `consoleLogger` e o pino têm os dois. Os níveis
   * seguem o pino e o OpenTelemetry: `trace` abaixo de `debug`, `fatal` acima de `error`.
   */
  trace?(obj: object, msg?: string): void;
  trace?(msg: string): void;
  fatal?(obj: object, msg?: string): void;
  fatal?(msg: string): void;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

const LEVELS: Record<LogLevel, number> = { trace: 5, debug: 10, info: 20, warn: 30, error: 40, fatal: 50, silent: 99 };

/** Método do `console` de cada nível (`trace` e `fatal` não existem lá com esse sentido). */
const CONSOLE_METHOD = { trace: 'debug', debug: 'debug', info: 'info', warn: 'warn', error: 'error', fatal: 'error' } as const;

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
  /**
   * `'stdout'` manda todos os níveis para a saída padrão. O padrão (`'console'`) segue o `console`: `warn`,
   * `error` e `fatal` vão para o stderr, que alguns coletores tratam inteiro como erro (F-38).
   */
  stream?: 'console' | 'stdout';
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
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'password',
  'passwd',
  'secret',
  'client-secret',
  'token',
  'access-token',
  'refresh-token',
  'id-token',
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
  return new ConsoleLogger(compileConsoleConfig(opts), bindings);
}

/** Configuração compilada uma vez e compartilhada por todos os loggers filhos (Flyweight, F-39). */
interface ConsoleConfig {
  readonly min: number;
  readonly keys: ReadonlySet<string> | undefined;
  readonly json: boolean;
  readonly stdout: boolean;
}

function compileConsoleConfig(opts: ConsoleLoggerOptions): ConsoleConfig {
  return {
    min: LEVELS[opts.level ?? 'info'],
    keys: opts.redact === false ? undefined : new Set([...DEFAULT_REDACT_KEYS, ...(opts.redact ?? [])].map(normalizeKey)),
    json: opts.format === 'json',
    stdout: opts.stream === 'stdout',
  };
}

/**
 * Um `child()` por requisição custa só este objeto com as bindings: os métodos ficam no protótipo e a
 * configuração (nível, `Set` do redact, formato) é a mesma do logger pai.
 */
class ConsoleLogger implements Logger {
  constructor(
    private readonly cfg: ConsoleConfig,
    private readonly bindings: Record<string, unknown>,
  ) {}

  trace(objOrMsg: object | string, msg?: string): void {
    this.emit('trace', objOrMsg, msg);
  }
  debug(objOrMsg: object | string, msg?: string): void {
    this.emit('debug', objOrMsg, msg);
  }
  info(objOrMsg: object | string, msg?: string): void {
    this.emit('info', objOrMsg, msg);
  }
  warn(objOrMsg: object | string, msg?: string): void {
    this.emit('warn', objOrMsg, msg);
  }
  error(objOrMsg: object | string, msg?: string): void {
    this.emit('error', objOrMsg, msg);
  }
  fatal(objOrMsg: object | string, msg?: string): void {
    this.emit('fatal', objOrMsg, msg);
  }
  child(extra: Record<string, unknown>): Logger {
    return new ConsoleLogger(this.cfg, { ...this.bindings, ...extra });
  }

  private emit(level: Exclude<LogLevel, 'silent'>, objOrMsg: object | string, msg?: string): void {
    if (LEVELS[level] < this.cfg.min) return;
    const [data, text] = typeof objOrMsg === 'string' ? [{}, objOrMsg] : [objOrMsg, msg ?? ''];
    const merged = { ...this.bindings, ...data };
    const keys = this.cfg.keys;
    const safe = (keys ? redactValue(merged, keys) : merged) as Record<string, unknown>;
    const out = this.cfg.stdout ? 'log' : CONSOLE_METHOD[level];
    if (this.cfg.json) {
      console[out](toJsonLine({ level, time: new Date().toISOString(), msg: text, ...safe }));
    } else {
      console[out](`[sashiko] ${text}`, safe);
    }
  }
}

/** Logger que descarta tudo (`createApp({ logger: false })`). */
export const silentLogger: Logger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  child: () => silentLogger,
};

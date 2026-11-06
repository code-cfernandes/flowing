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
}

/**
 * Logger padrão sobre o `console`, sem dependências. Formato: `[picodecor] mensagem { ...dados }`.
 * Não registra headers nem body: dados sensíveis só entram se você os passar (S-11).
 */
export function consoleLogger(opts: ConsoleLoggerOptions = {}, bindings: Record<string, unknown> = {}): Logger {
  const min = LEVELS[opts.level ?? 'info'];
  const emit = (level: Exclude<LogLevel, 'silent'>) => (objOrMsg: object | string, msg?: string) => {
    if (LEVELS[level] < min) return;
    const [data, text] = typeof objOrMsg === 'string' ? [{}, objOrMsg] : [objOrMsg, msg ?? ''];
    console[level](`[picodecor] ${text}`, { ...bindings, ...data });
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

/**
 * Etapa em que a requisição estava quando um erro chegou ao `onError` (F-38). No modelo onion, um erro
 * lançado depois do `await next()` de um middleware aparece com a etapa mais recente (`handler`, `response`).
 * `validation` inclui a leitura do body (JSON inválido, limite de tamanho).
 */
export type ErrorPhase = 'middleware' | 'guard' | 'validation' | 'handler' | 'response';

/** Por que o `ctx.signal` de uma requisição foi cancelado (F-38). */
export type AbortCode = 'CLIENT_DISCONNECTED' | 'SHUTDOWN' | 'TIMEOUT';

const MESSAGES: Record<AbortCode, string> = {
  CLIENT_DISCONNECTED: 'client disconnected',
  SHUTDOWN: 'server shutting down',
  TIMEOUT: 'request timed out',
};

/**
 * O `ctx.signal.reason` de uma requisição cancelada. Use o `code` para decidir em código:
 *
 * ```ts
 * if (ctx.signal.reason?.code === 'SHUTDOWN') return; // o app está encerrando, não é erro
 * ```
 *
 * `TIMEOUT` está reservado para um futuro timeout por rota.
 */
export class RequestAbortedError extends Error {
  override readonly name = 'RequestAbortedError';
  constructor(readonly code: AbortCode) {
    super(MESSAGES[code]);
  }
}

/** Contexto de trace W3C recebido (`traceparent`/`tracestate`), em `ctx.trace` (F-38). */
export interface TraceContext {
  /** 32 caracteres hex. */
  readonly traceId: string;
  /** Span de quem chamou: 16 caracteres hex. */
  readonly parentSpanId: string;
  /** Flag `sampled` de quem chamou. */
  readonly sampled: boolean;
  /** `tracestate` recebido, se válido. */
  readonly tracestate?: string;
}

// https://www.w3.org/TR/trace-context/#traceparent-header-field-values
const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/;
const ZERO_TRACE = '0'.repeat(32);
const ZERO_SPAN = '0'.repeat(16);
/** Lista de `chave=valor` separados por vírgula, só com ASCII imprimível; até 512 caracteres. */
const TRACESTATE = /^[\x20-\x7e]{1,512}$/;

/**
 * Valida o `traceparent` pela especificação W3C: versão `ff` é inválida, ids zerados também, e a versão `00`
 * não admite campos extras (versões futuras admitem). Maiúsculas são rejeitadas, como manda a especificação.
 */
export function parseTraceparent(traceparent: unknown, tracestate?: unknown): TraceContext | undefined {
  if (typeof traceparent !== 'string' || traceparent.length > 512) return undefined;
  const m = TRACEPARENT.exec(traceparent.trim());
  if (!m) return undefined;
  const [, version, traceId, parentSpanId, flags, extra] = m as unknown as [string, string, string, string, string, string?];
  if (version === 'ff' || (version === '00' && extra !== undefined)) return undefined;
  if (traceId === ZERO_TRACE || parentSpanId === ZERO_SPAN) return undefined;
  const state = typeof tracestate === 'string' && TRACESTATE.test(tracestate) ? tracestate : undefined;
  return Object.freeze({
    traceId,
    parentSpanId,
    sampled: (Number.parseInt(flags, 16) & 1) === 1,
    ...(state === undefined ? {} : { tracestate: state }),
  });
}

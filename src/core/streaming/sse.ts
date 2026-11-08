/**
 * Server-Sent Events (F-13). Fica fora do `Context`, que só delega: o modelo da requisição não carrega a
 * lógica de cada forma de envio.
 */
import type { Context } from '../context.ts';

/** Um evento de Server-Sent Events (F-13). `data` em objeto vira JSON; strings com várias linhas são divididas. */
export interface SseEvent {
  data: unknown;
  event?: string;
  id?: string;
  /** Sugestão de espera para o navegador reconectar, em ms. */
  retry?: number;
}

/** Conexão SSE aberta por `ctx.sse()`. */
export interface SseStream {
  send(event: SseEvent | string): void;
  /** Comentário (`: texto`), ignorado pelo navegador; útil como keep-alive. */
  comment(text: string): void;
  /** Encerra a resposta. */
  close(): void;
  /** Chamado quando a conexão termina: o cliente desconectou, `close()` ou encerramento do app. */
  onClose(listener: () => void): void;
  readonly closed: boolean;
  /** `Last-Event-ID` enviado pelo navegador ao reconectar. */
  readonly lastEventId: string | undefined;
}

export interface SseOptions {
  /** Comentário periódico para proxies não derrubarem a conexão ociosa. Padrão: 15000 ms; `0` desliga. */
  heartbeatMs?: number;
  /** `retry:` enviado na abertura. */
  retry?: number;
}

/**
 * Campos de uma linha SSE não podem ter quebra de linha (seria injeção de evento); `id` também não pode
 * ter U+0000, que faz o navegador ignorar o campo.
 */
const sseField = (name: string, value: string) => {
  if (/[\r\n]/.test(value)) throw new Error(`[flowing] ctx.sse(): "${name}" cannot contain line breaks.`);
  if (name === 'id' && value.includes('\0')) throw new Error('[flowing] ctx.sse(): "id" cannot contain U+0000.');
  return `${name}: ${value}\n`;
};

/** Maior intervalo dos timers do Node; acima disso, ele usa 1 ms (heartbeat contínuo). */
const MAX_TIMER_MS = 2_147_483_647;

/** `retry` e `heartbeatMs`: inteiro não negativo, como o protocolo exige, e dentro do limite dos timers. */
const nonNegativeInt = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value < 0 || value > MAX_TIMER_MS) {
    throw new Error(`[flowing] ctx.sse(): "${name}" must be an integer between 0 and ${MAX_TIMER_MS} (got ${value}).`);
  }
  return value;
};

/** `data` do evento: strings como estão; o resto em JSON. Valor que não vira JSON gera erro claro, sem escrever nada. */
function sseData(data: unknown): string {
  if (typeof data === 'string') return data;
  let text: string | undefined;
  try {
    text = JSON.stringify(data);
  } catch (err) {
    throw new Error(`[flowing] ctx.sse(): "data" is not JSON-serializable (${(err as Error).message}).`, { cause: err });
  }
  if (text === undefined) throw new Error(`[flowing] ctx.sse(): "data" of type ${typeof data} is not JSON-serializable.`);
  return text;
}

/** Abre a conexão SSE de `ctx`. `markStreaming` marca a resposta como stream (estado privado do `Context`). */
export function openSse(ctx: Context, opts: SseOptions, markStreaming: () => void): SseStream {
  if (ctx.sent) throw new Error('[flowing] ctx.sse(): the response was already sent.');
  // Valida antes de abrir a resposta: um erro aqui ainda vira um 500 normal.
  const heartbeatMs = nonNegativeInt('heartbeatMs', opts.heartbeatMs ?? 15_000);
  if (opts.retry !== undefined) nonNegativeInt('retry', opts.retry);
  const res = ctx.res;
  markStreaming();
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.removeHeader('Content-Length');
  res.flushHeaders();

  const listeners: (() => void)[] = [];
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const l of listeners.splice(0)) {
      try {
        l();
      } catch (err) {
        ctx.log.error({ err }, 'sse onClose listener failed');
      }
    }
  };
  const write = (chunk: string) => {
    if (!closed && !res.writableEnded) res.write(chunk);
  };
  const heartbeat = setInterval(() => write(': ping\n\n'), heartbeatMs || 2 ** 31 - 1);
  heartbeat.unref();
  if (!heartbeatMs) clearInterval(heartbeat);
  res.once('close', finish);
  const signal = ctx.signal;
  signal.addEventListener('abort', () => stream.close(), { once: true });
  if (opts.retry !== undefined) write(`retry: ${opts.retry}\n\n`);

  const stream: SseStream = {
    send: (event) => {
      const e: SseEvent = typeof event === 'string' ? { data: event } : event;
      let out = '';
      if (e.event !== undefined) out += sseField('event', e.event);
      if (e.id !== undefined) out += sseField('id', e.id);
      if (e.retry !== undefined) out += `retry: ${nonNegativeInt('retry', e.retry)}\n`;
      if (e.data === undefined) throw new Error('[flowing] ctx.sse(): "data" is required; use "" for an empty event.');
      const text = sseData(e.data);
      for (const line of text.split(/\r\n|\r|\n/)) out += `data: ${line}\n`;
      write(`${out}\n`);
    },
    comment: (text) => write(`: ${text.replace(/[\r\n]+/g, ' ')}\n\n`),
    close: () => {
      if (!res.writableEnded) res.end();
      finish();
    },
    onClose: (listener) => {
      if (closed) listener();
      else listeners.push(listener);
    },
    get closed() {
      return closed;
    },
    lastEventId: ctx.get('last-event-id'),
  };
  // O cliente pode ter desconectado antes do `ctx.sse()` (num `await` anterior): o 'close' e o 'abort' já
  // passaram, e os listeners acima nunca rodariam. Encerra já, limpando o heartbeat e chamando `onClose`.
  if (signal.aborted) stream.close();
  return stream;
}

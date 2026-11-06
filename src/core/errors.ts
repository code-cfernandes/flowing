import type { Context } from './context.ts';

export interface HttpErrorOptions {
  /**
   * Se a mensagem pode ser enviada ao cliente.
   * Padrão: `true` para 4xx e `false` para 5xx, para não vazar detalhes internos (S-05).
   */
  expose?: boolean;
  cause?: unknown;
  /** Dados extras enviados ao cliente junto da mensagem (ex.: erros de validação). */
  details?: unknown;
  /** URI que identifica o tipo do problema (RFC 9457). Padrão: `'about:blank'`. */
  type?: string;
}

/**
 * Corpo de erro no formato Problem Details (RFC 9457), enviado como `application/problem+json`.
 * `code` e `details` são membros de extensão do Sashiko.
 */
export interface ProblemDetails {
  /** URI do tipo do problema. `'about:blank'` quando o status já diz tudo. */
  type: string;
  /** Resumo do tipo do problema; com `about:blank`, é a frase do status (`'Not Found'`). */
  title: string;
  status: number;
  /** Explicação desta ocorrência. Omitido em 5xx não expostos. */
  detail?: string;
  /** Código estável para o cliente tratar o erro (`'VALIDATION_ERROR'`). */
  code?: string;
  /** Dados extras, como os erros de validação. */
  details?: unknown;
}

/**
 * Personaliza o corpo de erro. Recebe o problema já montado (e sem dados internos em 5xx) e
 * devolve o corpo a enviar como JSON. Use para manter um formato legado ou adicionar campos.
 */
export type ErrorFormatter = (problem: ProblemDetails, ctx: Context) => unknown;

export class HttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly expose: boolean;
  readonly details: unknown;
  readonly type: string | undefined;

  constructor(status: number, message: string, code?: string, options: HttpErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.expose = options.expose ?? status < 500;
    this.details = options.details;
    this.type = options.type;
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}

export const notFound = (msg = 'Not Found') => new HttpError(404, msg, 'NOT_FOUND');
export const badRequest = (msg = 'Bad Request') => new HttpError(400, msg, 'BAD_REQUEST');
export const unauthorized = (msg = 'Unauthorized') => new HttpError(401, msg, 'UNAUTHORIZED');
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg, 'FORBIDDEN');
export const internal = (msg = 'Internal Server Error') => new HttpError(500, msg, 'INTERNAL');

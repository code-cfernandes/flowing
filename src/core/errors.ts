export interface HttpErrorOptions {
  /**
   * Se a mensagem pode ser enviada ao cliente.
   * Padrão: `true` para 4xx e `false` para 5xx, para não vazar detalhes internos (S-05).
   */
  expose?: boolean;
  cause?: unknown;
  /** Dados extras enviados ao cliente junto da mensagem (ex.: erros de validação). */
  details?: unknown;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly expose: boolean;
  readonly details: unknown;

  constructor(status: number, message: string, code?: string, options: HttpErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.expose = options.expose ?? status < 500;
    this.details = options.details;
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

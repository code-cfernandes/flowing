export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (msg = 'Not Found') => new HttpError(404, msg, 'NOT_FOUND');
export const badRequest = (msg = 'Bad Request') => new HttpError(400, msg, 'BAD_REQUEST');
export const unauthorized = (msg = 'Unauthorized') => new HttpError(401, msg, 'UNAUTHORIZED');
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg, 'FORBIDDEN');
export const internal = (msg = 'Internal Server Error') => new HttpError(500, msg, 'INTERNAL');
import type { Middleware } from './compose.ts';
import { isJsonContentType } from '../utils/content-type.ts';

/** Lê e parseia o body JSON, respeitando `limit` em bytes. Registrado pelo app como primeiro middleware. */
export function bodyParser(limit: number): Middleware {
  return async (ctx, next) => {
    if (ctx.method === 'GET' || ctx.method === 'HEAD') return next();
    if (!isJsonContentType(ctx.req.headers['content-type'])) return next();

    // B-12: rejeita cedo pelo Content-Length e fecha a conexão ao exceder,
    // para o cliente não continuar enviando um corpo que será descartado.
    const tooLarge = (): never => {
      ctx.res.setHeader('Connection', 'close');
      return ctx.throw(413, 'Payload too large', 'PAYLOAD_TOO_LARGE');
    };
    const declared = Number(ctx.req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) tooLarge();

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of ctx.req) {
      size += chunk.length;
      if (size > limit) tooLarge();
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw) {
      try { ctx.body = JSON.parse(raw); }
      catch { ctx.throw(400, 'Invalid JSON', 'INVALID_JSON'); }
    }
    await next();
  };
}

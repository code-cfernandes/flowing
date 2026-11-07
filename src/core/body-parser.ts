import type { Context } from './context.ts';
import { isJsonContentType } from '../utils/content-type.ts';
import { parseJson, ProtoPoisoningError, type ProtoPoisoning } from '../utils/safe-json.ts';

/**
 * Lê e parseia o body JSON, respeitando `limit` em bytes. O app chama antes dos middlewares globais, que
 * recebem o body já lido; é uma etapa direta, sem camada de middleware (F-39).
 */
export function bodyReader(limit: number, protoPoisoning: ProtoPoisoning = 'error'): (ctx: Context) => Promise<void> | undefined {
  // Síncrono quando não há body a ler (GET, HEAD, outro Content-Type): sem Promise por requisição (F-41).
  return (ctx) => {
    if (ctx.method === 'GET' || ctx.method === 'HEAD') return undefined;
    if (!isJsonContentType(ctx.req.headers['content-type'])) return undefined;
    return read(ctx);
  };

  async function read(ctx: Context): Promise<void> {
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
      try {
        ctx.body = parseJson(raw, protoPoisoning);
      } catch (err) {
        // S-08: `__proto__` e `constructor.prototype` no body são recusados (ou removidos, se configurado).
        if (err instanceof ProtoPoisoningError) ctx.throw(400, err.message, 'PROTO_POISONING');
        ctx.throw(400, 'Invalid JSON', 'INVALID_JSON');
      }
    }
  }
}

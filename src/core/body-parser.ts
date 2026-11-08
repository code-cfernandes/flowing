import type { Context } from './context.ts';
import { isJsonContentType, mediaType } from '../utils/content-type.ts';
import { parseJson, ProtoPoisoningError, type ProtoPoisoning, scrubParsed } from '../utils/safe-json.ts';

/**
 * Parser de body para um tipo de mídia (F-12): recebe o corpo cru, já limitado pelo `bodyLimit`, e devolve o valor
 * de `ctx.body`. Pode ser assíncrono. O resultado passa pela proteção contra prototype pollution (S-08) e é validado
 * pelo contrato da rota, como o JSON.
 */
export type BodyParser = (raw: Buffer, ctx: Context) => unknown;

/**
 * Lê e parseia o body: JSON nativo e os `parsers` do app (F-12), respeitando `limit` em bytes. O app chama antes dos
 * middlewares globais, que recebem o body já lido; é uma etapa direta, sem camada de middleware (F-39).
 */
export function bodyReader(
  limit: number,
  protoPoisoning: ProtoPoisoning = 'error',
  parsers: ReadonlyMap<string, BodyParser> = new Map(),
): (ctx: Context) => Promise<void> | undefined {
  // Síncrono quando não há body a ler (GET, HEAD, outro Content-Type): sem Promise por requisição (F-41).
  return (ctx) => {
    if (ctx.method === 'GET' || ctx.method === 'HEAD') return undefined;
    const contentType = ctx.req.headers['content-type'];
    if (isJsonContentType(contentType)) return readJson(ctx);
    // Sem parsers configurados, nem o tipo de mídia é calculado.
    if (parsers.size === 0) return undefined;
    const parser = parsers.get(mediaType(contentType));
    return parser ? readWith(ctx, parser) : undefined;
  };

  async function readRaw(ctx: Context): Promise<Buffer> {
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
    return Buffer.concat(chunks);
  }

  async function readJson(ctx: Context): Promise<void> {
    const raw = (await readRaw(ctx)).toString('utf8');
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

  async function readWith(ctx: Context, parser: BodyParser): Promise<void> {
    const raw = await readRaw(ctx);
    if (raw.length === 0) return;
    let value: unknown;
    try {
      value = await parser(raw, ctx);
    } catch {
      // A mensagem do parser pode expor detalhes internos: o cliente recebe só o motivo genérico.
      ctx.throw(400, 'Invalid body', 'INVALID_BODY');
    }
    try {
      scrubParsed(value, protoPoisoning);
    } catch (err) {
      ctx.throw(400, (err as Error).message, 'PROTO_POISONING');
    }
    ctx.body = value;
  }
}

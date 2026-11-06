import type { Context } from './context.ts';
import { HttpError } from './errors.ts';
import type { RouteSchemas } from './metadata.ts';
import { serialize } from '../schema/serialization.ts';

const GENERIC_500 = 'Internal Server Error';

/**
 * Envia o retorno do handler (B-05):
 * - Sem `ctx.status()` e com um único 2xx declarado, esse 2xx vira o status padrão.
 * - Com schemas de resposta declarados, um status sem schema correspondente **não** cai no
 *   `JSON.stringify`, que mandaria o objeto inteiro (S-07): vira 500 e o motivo vai para o log.
 * - Respostas sem corpo (`undefined`) dispensam schema.
 */
export function sendResult(ctx: Context, response: RouteSchemas['response'], result: unknown): void {
  if (response && !ctx.statusExplicit) {
    const success = Object.keys(response).map(Number).filter((s) => s >= 200 && s < 300);
    if (success.length === 1 && response[200] === undefined) ctx.res.statusCode = success[0]!;
  }

  if (result === undefined) return void ctx.res.end();

  const status = ctx.res.statusCode;
  const schema = response?.[status];
  if (schema) {
    ctx.res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return void ctx.res.end(serialize(schema, result));
  }
  if (response && Object.keys(response).length > 0) {
    throw new Error(`[sashiko] ${ctx.method} ${ctx.path}: no response schema for status ${status}`);
  }
  ctx.json(result);
}

/**
 * Resposta de erro padrão. Só mensagens marcadas como `expose` chegam ao cliente;
 * o resto vira 500 genérico e o erro original é logado no servidor (S-05).
 */
export function sendError(ctx: Context, err: unknown): void {
  const httpErr = err instanceof HttpError ? err : undefined;
  const status = httpErr?.status ?? 500;
  const exposed = httpErr?.expose === true;

  if (!exposed) ctx.log.error({ err, method: ctx.method, path: ctx.path, status }, 'request failed');
  if (ctx.res.writableEnded) return;
  if (ctx.res.headersSent) return void ctx.res.end();

  const body: { error: string; details?: unknown } = { error: exposed ? httpErr!.message : GENERIC_500 };
  if (exposed && httpErr!.details !== undefined) body.details = httpErr!.details;
  ctx.status(status).json(body);
}

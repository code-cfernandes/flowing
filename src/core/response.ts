import { type Context, kRawSend } from './context.ts';
import { HttpError } from './errors.ts';
import { isResponseContent, type RouteSchemas } from './metadata.ts';
import { Readable } from 'node:stream';
import { serialize } from '../schema/serialization.ts';
import { stripToSchema } from '../schema/validation.ts';
import { isJsonContentType, mediaType, negotiate, withCharset } from '../utils/content-type.ts';

const GENERIC_500 = 'Internal Server Error';

/** Converte dados num corpo de resposta para um content type (F-31). */
export type Serializer = (data: unknown) => string | Uint8Array;

/**
 * Como o corpo chegou ao pipeline (F-32): `auto` (`return` e `ctx.send()`), `json` (`ctx.json()`,
 * sempre JSON) ou `text` (`ctx.text()`, sempre texto).
 */
export type SendMode = 'auto' | 'json' | 'text';

const JSON_TYPE = 'application/json';

/**
 * Envia o retorno do handler.
 *
 * Status (B-05): sem `ctx.status()` e com um único 2xx declarado, esse 2xx vira o padrão. Com schemas
 * de resposta declarados, um status sem schema correspondente vira 500 em vez de enviar o objeto
 * sem filtro (S-07). Respostas sem corpo (`undefined`) dispensam schema.
 *
 * Content type (F-31), em ordem de prioridade:
 * 1. o `Content-Type` definido pelo handler;
 * 2. o `contentType` declarado no schema de resposta (com negociação pelo `Accept` se houver vários);
 * 3. schema de resposta sem `contentType` → JSON;
 * 4. sem schema, o tipo do valor: string → `text/plain`, Buffer/Uint8Array/stream → `application/octet-stream`,
 *    o resto → JSON.
 */
export function sendResult(
  ctx: Context,
  response: RouteSchemas['response'],
  result: unknown,
  serializers: ReadonlyMap<string, Serializer> = new Map(),
  mode: SendMode = 'auto',
): void {
  if (response && !ctx.statusExplicit) {
    const success = Object.keys(response).map(Number).filter((st) => st >= 200 && st < 300);
    if (success.length === 1 && response[200] === undefined) ctx.res.statusCode = success[0]!;
  }

  if (result === undefined) return void ctx.res.end();

  const status = ctx.res.statusCode;
  const entry = response?.[status];
  if (!entry && response && Object.keys(response).length > 0) {
    throw new Error(`[sashiko] ${ctx.method} ${ctx.path}: no response schema for status ${status}`);
  }

  const headerType = ctx.res.getHeader('Content-Type');
  const explicit = mode === 'json' ? JSON_TYPE
    : mode === 'text' ? 'text/plain'
    : typeof headerType === 'string' ? headerType : undefined;
  let type: string;
  let schema: object | undefined;
  let jsonSchemaDeclared = false;

  if (entry && isResponseContent(entry)) {
    schema = entry.schema;
    const offered = typeof entry.contentType === 'string' ? [entry.contentType] : [...entry.contentType];
    if (offered.length > 1) ctx.res.appendHeader('Vary', 'Accept');
    const chosen = explicit ?? negotiate(ctx.get('accept'), offered);
    if (!chosen) {
      throw new HttpError(406, 'Not Acceptable', 'NOT_ACCEPTABLE', { details: { available: offered } });
    }
    type = chosen;
  } else if (entry) {
    schema = entry;
    jsonSchemaDeclared = true;
    type = explicit ?? JSON_TYPE;
  } else {
    type = explicit ?? inferType(result);
  }

  write(ctx, type, result, schema, mode === 'json' || (jsonSchemaDeclared && !explicit), serializers);
}

function inferType(value: unknown): string {
  if (typeof value === 'string') return 'text/plain';
  if (value instanceof Uint8Array || value instanceof Readable) return 'application/octet-stream';
  return JSON_TYPE;
}

function write(
  ctx: Context,
  type: string,
  value: unknown,
  schema: object | undefined,
  forceJson: boolean,
  serializers: ReadonlyMap<string, Serializer>,
): void {
  const header = withCharset(type);
  const base = mediaType(type);
  const json = isJsonContentType(base);

  if (value instanceof Readable) return void ctx[kRawSend](value, header);

  // Valores crus (string/Buffer) vão como estão, exceto quando a rota declarou um schema JSON:
  // nesse caso `"olá"` continua sendo serializado como JSON, como sempre.
  if ((typeof value === 'string' || value instanceof Uint8Array) && !forceJson) {
    if (schema && typeof value === 'string') ensureValid(ctx, schema, value);
    return void ctx[kRawSend](value, header);
  }

  if (json) {
    ctx.res.setHeader('Content-Type', header);
    return void ctx.res.end(schema ? serialize(schema, value) : JSON.stringify(value));
  }

  const serializer = serializers.get(base);
  if (!serializer) {
    throw new Error(
      `[sashiko] ${ctx.method} ${ctx.path}: no serializer registered for "${base}". ` +
      `Add it to createApp({ serializers: { '${base}': (data) => ... } }).`,
    );
  }
  const data = schema ? ensureValid(ctx, schema, value) : value;
  ctx[kRawSend](Buffer.from(serializer(data)), header);
}

/** Valida a saída e devolve uma cópia sem campos não declarados (S-07 em qualquer formato). */
function ensureValid(ctx: Context, schema: object, value: unknown): unknown {
  const checked = stripToSchema(schema, value);
  if (!checked.ok) {
    throw new Error(
      `[sashiko] ${ctx.method} ${ctx.path}: response does not match its schema: ` +
      checked.issues.map((i) => `${i.path} ${i.message}`).join('; '),
    );
  }
  return checked.value;
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
  // Erros nunca passam pelo schema da rota (F-32): envio cru.
  ctx.res.statusCode = status;
  ctx[kRawSend](JSON.stringify(body), 'application/json; charset=utf-8');
}

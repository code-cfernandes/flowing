import type { Context } from '../context.ts';
import { kContracts, kRawSend } from '../symbols.ts';
import { STATUS_CODES } from 'node:http';
import { HttpError, type ErrorFormatter, type ProblemDetails } from '../errors.ts';
import { isResponseContent, type RouteSchemas } from '../metadata.ts';
import { Readable } from 'node:stream';
import { isJsonContentType, mediaType, negotiate, withCharset } from '../../utils/content-type.ts';

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
/**
 * O que cada rota sabe sobre a resposta, decidido no registro (Strategy, F-39): schemas, serializadores e o
 * status padrão (o único 2xx declarado, quando não há 200). O mesmo objeto serve a todas as requisições.
 */
export interface ResponsePlan {
  readonly response: RouteSchemas['response'];
  readonly serializers: ReadonlyMap<string, Serializer>;
  readonly defaultStatus: number | undefined;
}

/** Status padrão de uma rota (B-05): com um único 2xx declarado e sem 200, é esse 2xx. */
export function defaultStatusFor(response: RouteSchemas['response']): number | undefined {
  if (!response) return undefined;
  const success = Object.keys(response)
    .map(Number)
    .filter((st) => st >= 200 && st < 300);
  return success.length === 1 && response[200] === undefined ? success[0] : undefined;
}

export function responsePlan(response: RouteSchemas['response'], serializers: ReadonlyMap<string, Serializer>): ResponsePlan {
  return { response, serializers, defaultStatus: defaultStatusFor(response) };
}

const EMPTY_SERIALIZERS: ReadonlyMap<string, Serializer> = new Map();

export function sendResult(
  ctx: Context,
  response: RouteSchemas['response'],
  result: unknown,
  serializers: ReadonlyMap<string, Serializer> = EMPTY_SERIALIZERS,
  mode: SendMode = 'auto',
  defaultStatus: number | undefined = defaultStatusFor(response),
): void {
  if (defaultStatus !== undefined && !ctx.statusExplicit) ctx.res.statusCode = defaultStatus;

  if (result === undefined) return void ctx.res.end();

  const status = ctx.res.statusCode;
  const entry = response?.[status];
  if (!entry && response && Object.keys(response).length > 0) {
    throw new Error(`[flowing] ${ctx.method} ${ctx.path}: no response schema for status ${status}`);
  }

  const headerType = ctx.res.getHeader('Content-Type');
  const explicit = mode === 'json' ? JSON_TYPE : mode === 'text' ? 'text/plain' : typeof headerType === 'string' ? headerType : undefined;
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

const NDJSON = 'application/x-ndjson';

/** Async iterable que não é um stream (async generator, cursor de banco…) (F-13). */
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' && value !== null && !(value instanceof Readable) && Symbol.asyncIterator in value;
}

function inferType(value: unknown): string {
  if (typeof value === 'string') return 'text/plain';
  if (value instanceof Uint8Array || value instanceof Readable) return 'application/octet-stream';
  if (isAsyncIterable(value)) return NDJSON;
  return JSON_TYPE;
}

/** Cada item vira uma linha JSON (NDJSON). Com schema, cada item é validado e filtrado como uma resposta. */
function ndjson(ctx: Context, items: AsyncIterable<unknown>, schema: object | undefined): Readable {
  const signal = ctx.signal;
  return Readable.from(
    (async function* () {
      for await (const item of items) {
        if (signal.aborted) return; // cliente desconectou: para de consumir a fonte
        yield `${schema ? ctx[kContracts].serialize(schema, item) : JSON.stringify(item)}\n`;
      }
    })(),
  );
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

  if (isAsyncIterable(value)) {
    if (base !== NDJSON) {
      throw new Error(
        `[flowing] ${ctx.method} ${ctx.path}: an async iterable is streamed as NDJSON; declare ` +
          `response: { 200: { contentType: '${NDJSON}', schema: Item } } (the schema of each item), or return a Readable.`,
      );
    }
    return void ctx[kRawSend](ndjson(ctx, value, schema), header);
  }

  // Valores crus (string/Buffer) vão como estão, exceto quando a rota declarou um schema JSON:
  // nesse caso `"olá"` continua sendo serializado como JSON, como sempre.
  if ((typeof value === 'string' || value instanceof Uint8Array) && !forceJson) {
    if (schema && typeof value === 'string') ensureValid(ctx, schema, value);
    return void ctx[kRawSend](value, header);
  }

  if (json) {
    // Pelo ponto único de escrita (F-04): onSend e sentBody valem também para JSON.
    return void ctx[kRawSend](schema ? ctx[kContracts].serialize(schema, value) : JSON.stringify(value), header);
  }

  const serializer = serializers.get(base);
  if (!serializer) {
    throw new Error(
      `[flowing] ${ctx.method} ${ctx.path}: no serializer registered for "${base}". ` +
        `Add it to createApp({ serializers: { '${base}': (data) => ... } }).`,
    );
  }
  const data = schema ? ensureValid(ctx, schema, value) : value;
  ctx[kRawSend](Buffer.from(serializer(data)), header);
}

/** Valida a saída e devolve uma cópia sem campos não declarados (S-07 em qualquer formato). */
function ensureValid(ctx: Context, schema: object, value: unknown): unknown {
  const checked = ctx[kContracts].strip(schema, value);
  if (!checked.ok) {
    throw new Error(
      `[flowing] ${ctx.method} ${ctx.path}: response does not match its schema: ` +
        checked.issues.map((i) => `${i.path} ${i.message}`).join('; '),
    );
  }
  return checked.value;
}

/** Monta um Problem Details (RFC 9457). Sem `type`, usa `about:blank` e a frase do status como título. */
export function problem(
  status: number,
  detail?: string,
  extra: { code?: string | undefined; details?: unknown; type?: string | undefined } = {},
): ProblemDetails {
  const out: ProblemDetails = { type: extra.type ?? 'about:blank', title: STATUS_CODES[status] ?? 'Error', status };
  if (detail !== undefined && detail !== out.title) out.detail = detail;
  if (extra.code !== undefined) out.code = extra.code;
  if (extra.details !== undefined) out.details = extra.details;
  return out;
}

/** Escreve um problema (status + corpo), sem passar pelo schema da rota (F-32). */
export function sendProblem(ctx: Context, body: ProblemDetails, format?: ErrorFormatter): void {
  ctx.res.statusCode = body.status;
  if (format) {
    let custom: unknown;
    try {
      custom = format(body, ctx);
    } catch (err) {
      ctx.log.error({ err, method: ctx.method, path: ctx.path }, 'formatError failed; sending the default problem');
      return void ctx[kRawSend](JSON.stringify(body), 'application/problem+json; charset=utf-8');
    }
    return void ctx[kRawSend](JSON.stringify(custom), 'application/json; charset=utf-8');
  }
  ctx[kRawSend](JSON.stringify(body), 'application/problem+json; charset=utf-8');
}

/**
 * Resposta de erro padrão, no formato Problem Details (F-15). Só mensagens marcadas como `expose`
 * chegam ao cliente; o resto vira 500 genérico e o erro original é logado no servidor (S-05).
 */
export function sendError(ctx: Context, err: unknown, format?: ErrorFormatter): void {
  const httpErr = err instanceof HttpError ? err : undefined;
  const status = httpErr?.status ?? 500;
  const exposed = httpErr?.expose === true;

  if (!exposed) ctx.log.error({ err, method: ctx.method, path: ctx.path, status }, 'request failed');
  if (ctx.res.writableEnded) return;
  if (ctx.res.headersSent) return void ctx.res.end();

  const body = exposed
    ? problem(status, httpErr!.message, { code: httpErr!.code, details: httpErr!.details, type: httpErr!.type })
    : problem(status);
  sendProblem(ctx, body, format);
}

import type { RouteSchemas } from './metadata.ts';

/**
 * Inferência estrutural de tipos a partir de schemas (F-02), sem importar nenhuma biblioteca:
 * - TypeBox: lê o campo fantasma `static` (o mesmo que `Static<T>` usa).
 * - Standard Schema (Zod, Valibot, ArkType): lê `~standard.types.output` (prepara a F-27).
 * Qualquer outro schema cai no `Fallback`.
 */
export type InferSchema<T, Fallback = unknown> =
  [NonNullable<T>] extends [never] ? Fallback
  : NonNullable<T> extends { '~standard': { types?: { output: infer O } | undefined } } ? O
  : NonNullable<T> extends { static: unknown } ? (NonNullable<T> & { params: [] })['static']
  : Fallback;

/** Tipo de `ctx.params` para os schemas `S`. */
export type InferParams<S extends RouteSchemas> = InferSchema<S['params'], Record<string, string>>;
/** Tipo de `ctx.query` para os schemas `S`. */
export type InferQuery<S extends RouteSchemas> = InferSchema<S['query'], Record<string, string | string[]>>;
/** Tipo de `ctx.body` para os schemas `S`. */
export type InferBody<S extends RouteSchemas> = InferSchema<S['body'], unknown>;
/** Tipo dos headers validados para os schemas `S`. */
export type InferHeaders<S extends RouteSchemas> = InferSchema<S['headers'], Record<string, string | string[] | undefined>>;

/**
 * União dos tipos de resposta declarados (ou de um status específico).
 * Útil para anotar o retorno do handler: `create(ctx): InferResponse<typeof create, 201>`.
 */
export type InferResponse<S extends RouteSchemas, Status extends number = number> =
  S['response'] extends Record<number, unknown>
    ? { [K in keyof S['response'] & Status]: InferSchema<S['response'][K]> }[keyof S['response'] & Status]
    : unknown;

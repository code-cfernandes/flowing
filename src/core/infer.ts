import type { RouteSchemas } from './metadata.ts';

/**
 * Inferência estrutural de tipos a partir de schemas (F-02), sem importar nenhuma biblioteca:
 * - TypeBox: lê o campo fantasma `static` (o mesmo que `Static<T>` usa).
 * - Standard Schema (Zod, Valibot, ArkType): lê `~standard.types.output` (prepara a F-27).
 * Qualquer outro schema cai no `Fallback`.
 */
export type InferSchema<T, Fallback = unknown> = [NonNullable<T>] extends [never]
  ? Fallback
  : NonNullable<T> extends { '~standard': { types?: { output: infer O } | undefined } }
    ? O
    : NonNullable<T> extends { static: unknown }
      ? (NonNullable<T> & { params: [] })['static']
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
    ? { [K in keyof S['response'] & Status]: InferSchema<UnwrapResponse<S['response'][K]>> }[keyof S['response'] & Status]
    : unknown;

/** `{ contentType, schema }` → `schema`; um schema JSON direto continua como está (F-31). */
type UnwrapResponse<E> = E extends { contentType: unknown; schema: infer S } ? S : E extends { contentType: unknown } ? undefined : E;

// ---------- Parâmetros do path (F-29) ----------

/** Corta o nome de um parâmetro no primeiro delimitador do find-my-way (`/`, `-`, `.`, `(`). */
type ParamHead<R extends string, Acc extends string = ''> = R extends `${infer C}${infer T}`
  ? C extends '/' | '-' | '.' | '('
    ? [Acc, R]
    : ParamHead<T, `${Acc}${C}`>
  : [Acc, ''];

/** Descarta a regex de um parâmetro (`(^\\d+)…` → `…`). */
type SkipRegex<R extends string> = R extends `(${string})${infer Rest}` ? Rest : R;

type ParamNames<P extends string> = P extends `${string}:${infer R}`
  ? R extends `:${infer Escaped}`
    ? ParamNames<Escaped> // `::` é um ':' literal
    : ParamHead<R> extends [infer N extends string, infer Rest extends string]
      ? N | ParamNames<SkipRegex<Rest>>
      : never
  : never;

/**
 * Nomes dos parâmetros de um path: `PathParams<'/:orgId/users/:id'>` → `'orgId' | 'id'`.
 * Regex (`/:id(^\\d+)`) é ignorada, e o curinga final (`/files/*`) vira `'*'`.
 * Com um `string` não literal, resulta em `string`.
 */
export type PathParams<P extends string> = string extends P ? string : ParamNames<P> | (P extends `${string}*` ? '*' : never);

/** `ctx.params` a partir só do path: `{ orgId: string; id: string }`. */
export type ParamsOf<P extends string> = string extends P ? Record<string, string> : { [K in PathParams<P>]: string };

type SchemaKeys<T> = [T] extends [undefined] ? never : keyof InferSchema<T, Record<never, never>> & string;

/**
 * Confere, em compilação, que todo parâmetro do path está no schema de `params` (F-29). Chaves a mais
 * no schema podem vir do prefixo do `@Router`/`mount`, que o decorator não enxerga: essas são
 * conferidas no registro. Resulta em `unknown` quando está tudo certo (ou não dá para saber).
 */
export type CheckParams<P extends string, S> = string extends P
  ? unknown
  : S extends { params: infer T }
    ? [Exclude<PathParams<P>, SchemaKeys<T>>] extends [never]
      ? unknown
      : { params: `Missing in params schema: "${Exclude<PathParams<P>, SchemaKeys<T>>}"` }
    : unknown;

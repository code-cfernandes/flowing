import AjvModule, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';

// Interop explícito: o TS em ESM + verbatimModuleSyntax resolve o default
// como namespace; pegamos o `.default` real em runtime (que o Node injeta
// via CJS interop) e caímos no próprio módulo se ele já for o valor.
// biome-ignore lint/suspicious/noExplicitAny: interop CJS/ESM do ajv, resolvido em runtime.
const Ajv = ((AjvModule as any).default ?? AjvModule) as typeof import('ajv').default;
// biome-ignore lint/suspicious/noExplicitAny: interop CJS/ESM do ajv-formats, resolvido em runtime.
const addFormats = ((addFormatsModule as any).default ?? addFormatsModule) as (
  ajv: InstanceType<typeof Ajv>,
  opts?: Record<string, unknown>,
) => void;

export type ValidationTarget = 'params' | 'query' | 'headers' | 'body';

export interface ValidationIssue {
  /** JSON Pointer do campo inválido (`/email`, `/items/0/id`). `/` = raiz. */
  path: string;
  message: string;
}

function createAjv(coerceTypes: boolean | 'array') {
  const ajv = new Ajv({ allErrors: true, coerceTypes, useDefaults: true, removeAdditional: false });
  addFormats(ajv);
  return ajv;
}

/**
 * Duas instâncias (B-06):
 * - `coercing`: params/query/headers chegam sempre como string, então convertemos
 *   para o tipo declarado (`"5"` → `5`).
 * - `strict`: o body já é JSON tipado; coerção mascararia erros do cliente
 *   (`"30"` virar `30`, `""` virar `0`).
 */
// 'array' também converte valor único em array quando o schema pede array (`?tag=a` → `['a']`, B-07)
const coercing = createAjv('array');
const strict = createAjv(false);

// F-31: para respostas em formatos não JSON, remove TODOS os campos não declarados (como o
// fast-json-stringify faz no JSON) antes do serializador, sem alterar o objeto do handler.
const stripper = new Ajv({ allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: 'all' });
addFormats(stripper);
const stripCache = new WeakMap<object, ValidateFunction>();

/**
 * Valida `data` contra `schema` sobre uma cópia, removendo campos não declarados.
 * Retorna a cópia filtrada, ou os problemas encontrados.
 */
export function stripToSchema(schema: object, data: unknown): { ok: true; value: unknown } | { ok: false; issues: ValidationIssue[] } {
  let fn = stripCache.get(schema);
  if (!fn) {
    fn = stripper.compile(schema);
    stripCache.set(schema, fn);
  }
  const copy: unknown = data === undefined ? undefined : JSON.parse(JSON.stringify(data));
  return fn(copy) ? { ok: true, value: copy } : { ok: false, issues: formatErrors(fn.errors ?? []) };
}

const caches = new Map([
  [coercing, new WeakMap<object, ValidateFunction>()],
  [strict, new WeakMap<object, ValidateFunction>()],
]);

function compile(schema: object, target: ValidationTarget): ValidateFunction {
  const ajv = target === 'body' ? strict : coercing;
  const cache = caches.get(ajv)!;
  let fn = cache.get(schema);
  if (!fn) {
    fn = ajv.compile(schema);
    cache.set(schema, fn);
  }
  return fn;
}

/** Valida `data` contra `schema`. Retorna `null` se válido, ou a lista de problemas (B-02). */
export function validate(schema: object, data: unknown, target: ValidationTarget): ValidationIssue[] | null {
  const fn = compile(schema, target);
  return fn(data) ? null : formatErrors(fn.errors ?? []);
}

export function formatErrors(errors: ErrorObject[]): ValidationIssue[] {
  return errors.map((e) => {
    const missing = e.keyword === 'required' ? `/${(e.params as { missingProperty: string }).missingProperty}` : '';
    return { path: `${e.instancePath}${missing}` || '/', message: e.message ?? 'invalid' };
  });
}

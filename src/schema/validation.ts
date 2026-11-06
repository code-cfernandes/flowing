import AjvModule from 'ajv';
import addFormatsModule from 'ajv-formats';

// Interop explícito: o TS em ESM + verbatimModuleSyntax resolve o default
// como namespace; pegamos o `.default` real em runtime (que o Node injeta
// via CJS interop) e caímos no próprio módulo se ele já for o valor.
const Ajv = ((AjvModule as any).default ?? AjvModule) as typeof import('ajv').default;
const addFormats = ((addFormatsModule as any).default ?? addFormatsModule) as (
  ajv: any,
  opts?: Record<string, unknown>,
) => void;

const ajv = new Ajv({ allErrors: true, coerceTypes: true, removeAdditional: true });
addFormats(ajv);

const cache = new WeakMap<object, ReturnType<typeof ajv.compile>>();

export function validate(schema: object, data: unknown): boolean {
  let validator = cache.get(schema);
  if (!validator) {
    validator = ajv.compile(schema);
    cache.set(schema, validator);
  }
  return validator(data) as boolean;
}

export function formatErrors(validator: any): string {
  return (validator.errors ?? [])
    .map((e: any) => `${e.instancePath || '/'} ${e.message}`)
    .join('; ');
}
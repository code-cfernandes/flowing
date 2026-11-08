import { serialize } from '../schema/serialization.ts';
import { stripToSchema, validate, type ValidationIssue, type ValidationTarget } from '../schema/validation.ts';

/**
 * O motor dos contratos das rotas (F-27): quem valida a entrada, filtra a saída e descreve o schema para o OpenAPI.
 * Um por app, explícito: `createApp({ contracts: contracts.standard() })`. Sem a opção, vale o `contracts.native()`.
 * Um schema que não pertence ao motor do app é recusado no registro da rota: não há mistura.
 */
export interface Contracts {
  /** `native` (o padrão do FlowingTS) ou `standard` (Zod, Valibot, ArkType). */
  readonly kind: 'native' | 'standard';
  /** O schema é deste motor? Conferido no registro de cada rota. */
  owns(schema: unknown): boolean;
  /**
   * Valida uma parte da entrada. `value` é o valor a usar daí em diante (o motor pode convertê-lo ou aplicar
   * valores padrão). Pode ser assíncrono no motor `standard`.
   */
  check(schema: unknown, data: unknown, target: ValidationTarget): CheckResult | Promise<CheckResult>;
  /** Serializa uma resposta JSON pelo schema, sem campos não declarados. Lança se a saída não corresponde. */
  serialize(schema: unknown, data: unknown): string;
  /** Valida a saída e devolve uma cópia sem campos não declarados (respostas em outros formatos). */
  strip(schema: unknown, data: unknown): CheckResult;
  /** O JSON Schema do schema, para o OpenAPI; `undefined` se o motor não sabe convertê-lo. */
  toJsonSchema(schema: unknown): object | undefined;
}

export type CheckResult = { ok: true; value: unknown } | { ok: false; issues: ValidationIssue[] };

// ---------------------------------------------------------------------------------------------------------------
// Nativo: o comportamento de sempre (JSON Schema, que o TypeBox gera).
// ---------------------------------------------------------------------------------------------------------------

const isStandard = (schema: unknown): schema is StandardSchemaV1 =>
  typeof schema === 'object' &&
  schema !== null &&
  typeof (schema as { '~standard'?: { validate?: unknown } })['~standard']?.validate === 'function';

const NATIVE: Contracts = {
  kind: 'native',
  owns: (schema) => typeof schema === 'object' && schema !== null && !isStandard(schema),
  check(schema, data, target) {
    // O Ajv converte e aplica os padrões no próprio objeto: o valor validado é o mesmo.
    const issues = validate(schema as object, data, target);
    return issues ? { ok: false, issues } : { ok: true, value: data };
  },
  serialize: (schema, data) => serialize(schema as object, data),
  strip: (schema, data) => stripToSchema(schema as object, data),
  toJsonSchema: (schema) => schema as object,
};

// ---------------------------------------------------------------------------------------------------------------
// Standard Schema: Zod 3.24+ e 4, Valibot, ArkType. A interface é só de tipos, copiada da especificação
// (https://standardschema.dev), como ela recomenda: nenhuma dependência.
// ---------------------------------------------------------------------------------------------------------------

/** O mínimo da especificação Standard Schema v1 que o FlowingTS usa. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | {
      readonly issues: ReadonlyArray<{
        readonly message: string;
        readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
      }>;
    };

/** O caminho de uma issue no formato das demais (JSON Pointer): `['items', 0, 'id']` → `/items/0/id`. */
function pointer(path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined): string {
  if (!path || path.length === 0) return '/';
  return `/${path
    .map((seg) =>
      String(typeof seg === 'object' && seg !== null ? seg.key : seg)
        .replace(/~/g, '~0')
        .replace(/\//g, '~1'),
    )
    .join('/')}`;
}

function toCheck<O>(result: StandardResult<O>): CheckResult {
  if (result.issues) return { ok: false, issues: result.issues.map((i) => ({ path: pointer(i.path), message: i.message })) };
  return { ok: true, value: result.value };
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';

/** A resposta é síncrona: um schema com validação assíncrona não serve para a saída. */
function checkSync(schema: unknown, data: unknown): CheckResult {
  const result = (schema as StandardSchemaV1)['~standard'].validate(data);
  if (isThenable(result)) {
    throw new Error('[flowing] contracts.standard(): response schemas must validate synchronously (no async refinements).');
  }
  return toCheck(result);
}

export interface StandardContractsOptions {
  /**
   * Converte um schema em JSON Schema, para o OpenAPI. Com Zod 4: `{ toJSONSchema: (s) => z.toJSONSchema(s) }`.
   * Sem esta opção, as rotas aparecem no OpenAPI sem os schemas.
   */
  toJSONSchema?: (schema: StandardSchemaV1) => object;
}

function standard(opts: StandardContractsOptions = {}): Contracts {
  return {
    kind: 'standard',
    owns: isStandard,
    check(schema, data) {
      const result = (schema as StandardSchemaV1)['~standard'].validate(data);
      return isThenable(result) ? Promise.resolve(result).then(toCheck) : toCheck(result);
    },
    serialize(schema, data) {
      const checked = checkSync(schema, data);
      if (!checked.ok) {
        throw new Error(`response does not match its schema: ${checked.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
      }
      // O schema devolve o valor sem os campos não declarados (o z.object faz isso por padrão).
      return JSON.stringify(checked.value);
    },
    strip: (schema, data) => checkSync(schema, data),
    toJsonSchema(schema) {
      if (!opts.toJSONSchema) return undefined;
      try {
        return opts.toJSONSchema(schema as StandardSchemaV1);
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * Os motores de contrato do FlowingTS (F-27):
 * - `contracts.native()`: o padrão (schemas TypeBox / JSON Schema, validados pelo Ajv, saída pelo serializador
 *   compilado). Usado quando o app não declara nada.
 * - `contracts.standard()`: schemas Standard Schema (Zod, Valibot, ArkType). Sem coerção automática: em `params`
 *   e `query`, use os conversores da biblioteca (`z.coerce.number()`).
 */
export const contracts = {
  native: (): Contracts => NATIVE,
  standard,
};

/** O motor padrão, para quem não configurou nada. */
export const NATIVE_CONTRACTS = NATIVE;

import type { Context } from './context.ts';
import { HttpError } from './errors.ts';
import type { RouteSchemas } from './metadata.ts';
import type { ValidationTarget } from '../schema/validation.ts';
import { isPromiseLike } from './compose.ts';
import type { CheckResult } from './contracts.ts';
import { kContracts, kFiles } from './symbols.ts';

const VALIDATION_ORDER: readonly ValidationTarget[] = ['headers', 'params', 'query', 'body'];
const TARGET_LABEL: Record<ValidationTarget, string> = {
  headers: 'Invalid headers',
  params: 'Invalid params',
  query: 'Invalid query',
  body: 'Invalid body',
};

/** Valida cada parte da requisição que tiver schema; o primeiro erro vira 400 com detalhes (B-02/B-03). */
/**
 * Valida headers, params, query e body pelo motor dos contratos do app (F-27), nessa ordem. Síncrono no motor nativo;
 * com Standard Schema, vira assíncrono só quando um schema valida de forma assíncrona. O valor validado substitui
 * `ctx.params`, `ctx.query` e `ctx.body` (o motor pode converter e aplicar padrões); os headers não são trocados.
 */
export function validateRequest(ctx: Context, schemas: RouteSchemas): Promise<void> | undefined {
  return validateFrom(ctx, schemas, 0);
}

function validateFrom(ctx: Context, schemas: RouteSchemas, start: number): Promise<void> | undefined {
  const engine = ctx[kContracts];
  for (let i = start; i < VALIDATION_ORDER.length; i++) {
    const target = VALIDATION_ORDER[i]!;
    const schema = schemas[target];
    if (!schema) continue;
    const data = target === 'headers' ? { ...ctx.req.headers } : ctx[target];
    // Body de formulário (F-46): tudo chega como texto, então valida com coerção, como a query.
    const result = engine.check(schema, data, target === 'body' && ctx[kFiles] !== undefined ? 'query' : target);
    if (isPromiseLike(result)) return resumeAsync(ctx, schemas, i, data, result);
    apply(ctx, target, data, result);
  }
  return undefined;
}

/**
 * O resto da validação depois de um schema assíncrono. Fica fora do laço de propósito: um callback que captura
 * variáveis do laço faria o V8 alocar um contexto em toda requisição, mesmo no caminho síncrono (F-41).
 */
function resumeAsync(ctx: Context, schemas: RouteSchemas, i: number, data: unknown, pending: PromiseLike<CheckResult>): Promise<void> {
  return Promise.resolve(pending).then((r) => {
    apply(ctx, VALIDATION_ORDER[i]!, data, r);
    return validateFrom(ctx, schemas, i + 1);
  });
}

function apply(ctx: Context, target: ValidationTarget, data: unknown, result: CheckResult): void {
  if (!result.ok) throw new HttpError(400, TARGET_LABEL[target], 'VALIDATION_ERROR', { details: result.issues });
  if (target === 'headers' || result.value === data) return;
  if (target === 'body') ctx.body = result.value;
  else if (target === 'query') (ctx as { query: unknown }).query = result.value;
  else (ctx as { params: unknown }).params = result.value;
}

export function assertSchemas(owner: string, route: { method: string; path: string; schemas: RouteSchemas }): void {
  const where = `${owner}: ${route.method} ${route.path}`;
  if (['POST', 'PUT', 'PATCH'].includes(route.method) && !route.schemas.body && !route.schemas.files) {
    throw new Error(`[sashiko] requireSchemas: ${where} has no body schema.`);
  }
  if (!route.schemas.response || Object.keys(route.schemas.response).length === 0) {
    throw new Error(`[sashiko] requireSchemas: ${where} has no response schema.`);
  }
}

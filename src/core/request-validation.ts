import type { Context } from './context.ts';
import { HttpError } from './errors.ts';
import type { RouteSchemas } from './metadata.ts';
import { validate, type ValidationTarget } from '../schema/validation.ts';

const VALIDATION_ORDER: readonly ValidationTarget[] = ['headers', 'params', 'query', 'body'];
const TARGET_LABEL: Record<ValidationTarget, string> = {
  headers: 'Invalid headers',
  params: 'Invalid params',
  query: 'Invalid query',
  body: 'Invalid body',
};

/** Valida cada parte da requisição que tiver schema; o primeiro erro vira 400 com detalhes (B-02/B-03). */
export function validateRequest(ctx: Context, schemas: RouteSchemas): void {
  for (const target of VALIDATION_ORDER) {
    const schema = schemas[target];
    if (!schema) continue;
    // Headers: validamos uma cópia, para coerção/defaults não alterarem `req.headers`.
    const data = target === 'headers' ? { ...ctx.req.headers } : ctx[target];
    const issues = validate(schema, data, target);
    if (issues) throw new HttpError(400, TARGET_LABEL[target], 'VALIDATION_ERROR', { details: issues });
  }
}

/** Modo `requireSchemas` (S-07): falha no registro se a rota não tiver os schemas obrigatórios. */
export function assertSchemas(owner: string, route: { method: string; path: string; schemas: RouteSchemas }): void {
  const where = `${owner}: ${route.method} ${route.path}`;
  if (['POST', 'PUT', 'PATCH'].includes(route.method) && !route.schemas.body) {
    throw new Error(`[sashiko] requireSchemas: ${where} has no body schema.`);
  }
  if (!route.schemas.response || Object.keys(route.schemas.response).length === 0) {
    throw new Error(`[sashiko] requireSchemas: ${where} has no response schema.`);
  }
}

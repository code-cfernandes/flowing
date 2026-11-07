import { compileChain } from '../compose.ts';
import type { Context } from '../context.ts';
import { guardsMiddleware } from '../guard.ts';
import { validateRequest } from '../request-validation.ts';
import { responsePlan, sendResult, type Serializer } from '../response/pipeline.ts';
import type { RouteDefinition } from '../route-table.ts';
import { kBindResponse, kPendingSend } from '../symbols.ts';

/** A função completa de uma rota, montada uma vez no registro. */
export type RouteProgram = (ctx: Context) => Promise<void>;

/**
 * Builder (F-39): monta, no registro, o programa de cada rota. Antes, a cada requisição, o app criava o
 * array do pipeline, o middleware de guards, a closure final e o objeto de resposta.
 *
 * Ordem (F-01): middlewares da rota → guards → validação → handler → resposta. Os guards vêm antes da
 * validação, para quem não tem acesso receber 401/403, e não um 400 que revele o formato esperado.
 */
export function buildRouteProgram(route: RouteDefinition, serializers: ReadonlyMap<string, Serializer>): RouteProgram {
  const { schemas, handler } = route;
  const plan = responsePlan(schemas.response, serializers);
  const terminal = async (ctx: Context): Promise<void> => {
    validateRequest(ctx, schemas);
    // F-32: a partir daqui, ctx.json/send/text passam pelo mesmo pipeline do `return`.
    ctx[kBindResponse](plan);
    const result = await handler(ctx);
    if (ctx[kPendingSend]) await ctx[kPendingSend];
    if (!ctx.sent) sendResult(ctx, plan.response, result, plan.serializers, 'auto', plan.defaultStatus);
  };
  const layers = route.guards.length > 0 ? [...route.middlewares, guardsMiddleware(route.guards)] : route.middlewares;
  return layers.length === 0 ? terminal : compileChain(layers, terminal);
}

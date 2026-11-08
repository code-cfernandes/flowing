import { compileChain, isPromiseLike, type Step } from '../compose.ts';
import type { Context } from '../context.ts';
import { guardsMiddleware } from '../guard.ts';
import { validateRequest } from '../request-validation.ts';
import { responsePlan, sendResult, type Serializer } from '../response/pipeline.ts';
import type { RouteDefinition } from '../route-table.ts';
import { kBindResponse, kFiles, kPendingSend, kPhase } from '../symbols.ts';
import { receiveUploads, type UploadPlan, type UploadSettings, uploadPlan } from '../uploads/receive.ts';

/** A função completa de uma rota, montada uma vez no registro. */
export type RouteProgram = (ctx: Context) => Step;

/**
 * Builder (F-39): monta, no registro, o programa de cada rota. Antes, a cada requisição, o app criava o
 * array do pipeline, o middleware de guards, a closure final e o objeto de resposta.
 *
 * Ordem (F-01): middlewares da rota → guards → validação → handler → resposta. Os guards vêm antes da
 * validação, para quem não tem acesso receber 401/403, e não um 400 que revele o formato esperado.
 */
export function buildRouteProgram(
  route: RouteDefinition,
  serializers: ReadonlyMap<string, Serializer>,
  uploads: UploadSettings,
): RouteProgram {
  const { schemas, handler } = route;
  // Só rotas com `files` pagam pelo upload (F-46); as demais seguem o caminho de sempre.
  const upload = schemas.files ? uploadPlan(schemas.files, uploads, 'route') : undefined;
  const plan = responsePlan(schemas.response, serializers);
  const send = (ctx: Context, result: unknown): void => {
    ctx[kPhase] = 'response';
    if (!ctx.sent) sendResult(ctx, plan.response, result, plan.serializers, 'auto', plan.defaultStatus);
  };
  const finish = (ctx: Context, result: unknown): Step => {
    // Um sendFile() sem await no handler: espera o envio pendente antes de responder.
    const pending = ctx[kPendingSend];
    if (pending) return pending.then(() => send(ctx, result));
    send(ctx, result);
    return undefined;
  };
  // Síncrono quando o handler é síncrono: Promise só se o handler devolver uma (F-41).
  const terminal = (ctx: Context): Step => {
    ctx[kPhase] = 'validation';
    // Assíncrona só com um schema de validação assíncrona (Standard Schema); o nativo é sempre síncrono.
    if (upload) return receive(ctx, upload);
    const validating = validateRequest(ctx, schemas);
    return validating ? resume(validating, ctx) : run(ctx);
  };
  // Upload (F-46): recebe e confere os arquivos, põe os campos de texto no body e só então valida o contrato.
  const receive = (ctx: Context, plan: UploadPlan): Promise<void> =>
    receiveUploads(ctx, plan).then((received) => {
      ctx.body = received.fields as never;
      ctx[kFiles] = received.files;
      const validating = validateRequest(ctx, schemas);
      return validating ? resume(validating, ctx) : run(ctx);
    });
  // Separado do `terminal`: um callback ali capturaria o `ctx` e o V8 alocaria um contexto em toda requisição (F-41).
  const resume = (validating: Promise<void>, ctx: Context): Promise<void> => validating.then(() => run(ctx));
  const run = (ctx: Context): Step => {
    // F-32: a partir daqui, ctx.json/send/text passam pelo mesmo pipeline do `return`.
    ctx[kBindResponse](plan);
    ctx[kPhase] = 'handler';
    const result = handler(ctx);
    if (isPromiseLike(result)) return Promise.resolve(result).then((value) => finish(ctx, value));
    return finish(ctx, result);
  };
  const layers = route.guards.length > 0 ? [...route.middlewares, guardsMiddleware(route.guards)] : route.middlewares;
  return layers.length === 0 ? terminal : compileChain(layers, terminal);
}

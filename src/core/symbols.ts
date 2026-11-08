/** Símbolos internos do core. Ficam num módulo próprio para quem os usa não depender do `Context` em tempo de execução. */

/** @internal Envio cru, sem pipeline: usado pelo próprio pipeline, por erros e por 404/405. */
export const kRawSend = Symbol('flowing.rawSend');
/** @internal Cancela o `ctx.signal` (encerramento do app) (F-13). */
export const kAbort = Symbol('flowing.abort');
/** @internal Envio de arquivo em andamento, que o app aguarda mesmo sem `await` no handler (F-13). */
export const kPendingSend = Symbol('flowing.pendingSend');
/** @internal Liga o contexto aos schemas de resposta da rota, antes do handler (F-32). */
export const kBindResponse = Symbol('flowing.bindResponse');
/** @internal A cadeia global chegou ao roteamento (o último middleware chamou `next()`). */
export const kRouted = Symbol('flowing.routed');
/** @internal A rota que atendeu a requisição (`ctx.route`, F-38). */
export const kRoute = Symbol('flowing.route');
/** @internal O erro tratado pelo pipeline de erros, para o `onResponse` (F-38). */
export const kError = Symbol('flowing.error');
/** @internal Em que etapa a requisição está, para a fase do `onError` (F-38). */
export const kPhase = Symbol('flowing.phase');
/** @internal Estado do `telemetry` de uma requisição (F-38). */
export const kTelemetry = Symbol('flowing.telemetry');
/** @internal Instante em que os headers da resposta saíram, para o `ttfbMs` (F-38). */
export const kHeadersAt = Symbol('flowing.headersAt');
/** @internal Hooks com escopo da rota, guardados no `RouteInfo` de cada host (F-43). */
export const kHooks = Symbol('flowing.hooks');
/** @internal O motor dos contratos do app (`contracts`, F-27), lido pelo pipeline de resposta. */
export const kContracts = Symbol('flowing.contracts');
/** @internal Arquivos recebidos de um upload (F-46), lidos por `ctx.file()`/`ctx.files()`. */
export const kFiles = Symbol('flowing.files');

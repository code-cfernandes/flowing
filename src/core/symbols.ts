/** Símbolos internos do core. Ficam num módulo próprio para quem os usa não depender do `Context` em tempo de execução. */

/** @internal Envio cru, sem pipeline: usado pelo próprio pipeline, por erros e por 404/405. */
export const kRawSend = Symbol('sashiko.rawSend');
/** @internal Cancela o `ctx.signal` (encerramento do app) (F-13). */
export const kAbort = Symbol('sashiko.abort');
/** @internal Envio de arquivo em andamento, que o app aguarda mesmo sem `await` no handler (F-13). */
export const kPendingSend = Symbol('sashiko.pendingSend');
/** @internal Liga o contexto aos schemas de resposta da rota, antes do handler (F-32). */
export const kBindResponse = Symbol('sashiko.bindResponse');
/** @internal A cadeia global chegou ao roteamento (o último middleware chamou `next()`). */
export const kRouted = Symbol('sashiko.routed');
/** @internal A rota que atendeu a requisição (`ctx.route`, F-38). */
export const kRoute = Symbol('sashiko.route');
/** @internal O erro tratado pelo pipeline de erros, para o `onResponse` (F-38). */
export const kError = Symbol('sashiko.error');
/** @internal Em que etapa a requisição está, para a fase do `onError` (F-38). */
export const kPhase = Symbol('sashiko.phase');
/** @internal Estado do `telemetry` de uma requisição (F-38). */
export const kTelemetry = Symbol('sashiko.telemetry');
/** @internal Instante em que os headers da resposta saíram, para o `ttfbMs` (F-38). */
export const kHeadersAt = Symbol('sashiko.headersAt');

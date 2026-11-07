import type http from 'node:http';
import { performance } from 'node:perf_hooks';
import type { AppCore } from '../app/core.ts';
import type { OnResponseHook, ResponseInfo } from '../app/options.ts';
import { isPromiseLike, type Step } from '../compose.ts';
import type { Context } from '../context.ts';
import type { RouteInfo } from '../route-table.ts';
import { kError, kHeadersAt, kHooks, kPhase } from '../symbols.ts';

/** Grava o instante em que os headers da resposta saíram (a primeira vez), para o `ttfbMs`. */
export function markHeadersSent(res: http.ServerResponse): void {
  (res as unknown as Record<symbol, number | undefined>)[kHeadersAt] ??= performance.now();
}

function headersSentAt(res: http.ServerResponse): number | undefined {
  return (res as unknown as Record<symbol, number | undefined>)[kHeadersAt];
}

/**
 * Observer (F-38): tudo o que acompanha a requisição sem participar dela. Os hooks `onRequest` e
 * `onResponse`, o `logRequests` e o `telemetry` são observadores; o pipeline só avisa os momentos (início,
 * execução, rota resolvida, erro), e o fim é detectado aqui.
 *
 * Também é a única fonte da regra "há quem observe o fim" (`watching`), usada pelo pipeline e pelas
 * respostas do `listen()`. Sem observadores, nada é criado por requisição: o custo é zero.
 */
export class RequestObserver {
  constructor(private readonly core: AppCore) {}

  /**
   * Há quem observe o fim da requisição: `onResponse` (do app ou de alguma rota), `logRequests` ou `telemetry`.
   * A requisição ainda não foi roteada quando isso é decidido, então um `onResponse` de rota liga a observação
   * do app inteiro; sem nenhum, o custo continua zero.
   */
  get watching(): boolean {
    const core = this.core;
    return core.onResponseHooks.length > 0 || core.scopedOnResponse > 0 || core.telemetry !== undefined || core.opts.logRequests === true;
  }

  /**
   * Início da requisição, logo depois de criar o `Context` e antes da validação do `Host`: toda requisição
   * observada no início também é observada no fim. `started` é o instante de chegada, ou `-1` se ninguém
   * observa o fim.
   */
  start(ctx: Context, started: number): void {
    if (started !== -1) this.watchEnd(ctx, started);
    this.core.telemetry?.onRequest(ctx);
    if (this.core.onRequestHooks.length > 0) this.runOnRequest(ctx);
  }

  /** O pipeline, dentro do contexto do span criado pelo `telemetry` (se houver). */
  run(ctx: Context, fn: () => Step): Step {
    const telemetry = this.core.telemetry;
    return telemetry ? telemetry.run(ctx, fn) : fn();
  }

  /** A rota foi resolvida: o `telemetry` nomeia o span antes de a resposta sair. */
  routed(ctx: Context, route: RouteInfo): void {
    this.core.telemetry?.onRoute(ctx, route);
  }

  /** Um erro chegou ao pipeline de erros: guardado para o `onResponse` e registrado no span antes da resposta. */
  failed(ctx: Context, err: unknown): void {
    ctx[kError] = err;
    this.core.telemetry?.onError(ctx, err, ctx[kPhase]);
  }

  /**
   * Fim da requisição: o evento `close` dispara em todos os caminhos (inclusive cancelamento, que não tem
   * `finish`), e a trava garante uma única execução.
   */
  private watchEnd(ctx: Context, started: number): void {
    const res = ctx.res;
    let done = false;
    res.once('close', () => {
      if (done) return;
      done = true;
      const info = this.endInfo(ctx, started);
      this.core.telemetry?.onResponse(ctx, info);
      if (this.core.opts.logRequests) {
        const { status, ms, abortReason } = info;
        const entry = { method: ctx.method, path: ctx.path, status, ms, ...(abortReason ? { abortReason } : {}) };
        ctx.log.info(entry, abortReason ? 'request aborted' : 'request completed');
      }
      // Os do app primeiro, depois os da rota (F-43), na ordem de fora para dentro.
      for (const hook of this.core.onResponseHooks) this.runOnResponse(hook, ctx, info);
      const scoped = info.route?.[kHooks]?.onResponse;
      if (scoped) for (const hook of scoped) this.runOnResponse(hook, ctx, info);
    });
  }

  private endInfo(ctx: Context, started: number): ResponseInfo {
    const res = ctx.res;
    const round = (t: number) => Math.round((t - started) * 100) / 100;
    const abortReason = ctx.abortReason ?? (res.writableEnded ? undefined : 'CLIENT_DISCONNECTED');
    const status = res.statusCode;
    const error = ctx[kError];
    const route = ctx.route;
    // Gravado pelas respostas do `listen()` e do `inject()`; num servidor próprio (`callback()`), fica ausente.
    const ttfb = headersSentAt(res);
    return {
      status,
      ms: round(performance.now()),
      outcome: abortReason ? 'aborted' : status >= 500 ? 'error' : 'completed',
      streaming: ctx.streamingResponse,
      ...(abortReason ? { abortReason } : {}),
      ...(ttfb === undefined ? {} : { ttfbMs: round(ttfb) }),
      ...(route ? { route } : {}),
      ...(error === undefined ? {} : { error, errorPhase: ctx[kPhase] }),
    };
  }

  private runOnResponse(hook: OnResponseHook, ctx: Context, info: ResponseInfo): void {
    Promise.resolve()
      .then(() => hook(ctx, info))
      .catch((err: unknown) => ctx.log.error({ err }, 'onResponse hook failed'));
  }

  /** `onRequest` é síncrono: uma Promise devolvida não é esperada, mas a rejeição é logada. */
  private runOnRequest(ctx: Context): void {
    for (const hook of this.core.onRequestHooks) {
      try {
        const out: unknown = hook(ctx);
        if (isPromiseLike(out)) out.then(undefined, (err: unknown) => ctx.log.error({ err }, 'onRequest hook failed'));
      } catch (err) {
        ctx.log.error({ err }, 'onRequest hook failed');
      }
    }
  }
}

/**
 * OpenTelemetry nativo por injeção (F-38): `createApp({ telemetry: otel })`, com o `@opentelemetry/api` que a
 * aplicação já usa. O core não importa o pacote nem prende uma versão: só os tipos estruturais abaixo, o
 * mesmo modelo do `logger: pino()`.
 *
 * Com um span ativo (a auto-instrumentação HTTP do SDK já criou o span SERVER), o Sashiko **enriquece** esse
 * span, sem duplicar: nome `GET /users/:id`, `http.route` e as exceções com a fase. Esse span é encerrado pela
 * própria auto-instrumentação, dentro do `res.end()`, então o enriquecimento acontece no roteamento e no
 * tratamento de erro, antes da resposta. Sem span ativo, o Sashiko cria o span SERVER, a partir do
 * `traceparent` recebido, e o encerra no fim da requisição.
 */
import type { ResponseInfo } from './app/options.ts';
import type { ErrorPhase } from './abort.ts';
import type { Context } from './context.ts';
import type { RouteInfo } from './route-table.ts';
import { createRequire } from 'node:module';
import { kTelemetry } from './symbols.ts';

type Attributes = Record<string, string | number | boolean>;

/** O subconjunto de um `Span` do OpenTelemetry que o Sashiko usa. */
export interface TelemetrySpan {
  setAttribute(key: string, value: string | number | boolean): unknown;
  updateName(name: string): unknown;
  recordException(exception: unknown): unknown;
  setStatus(status: { code: number; message?: string }): unknown;
  addEvent?(name: string, attributes?: Attributes): unknown;
  end(): void;
  spanContext(): { traceId: string; spanId: string };
}

interface TelemetryInstrument {
  record?(value: number, attributes?: Attributes): void;
  add?(value: number, attributes?: Attributes): void;
}

/** O subconjunto do `@opentelemetry/api` que o Sashiko usa. Passe o módulo inteiro: `import * as otel`. */
export interface TelemetryApi {
  trace: {
    getActiveSpan(): TelemetrySpan | undefined;
    getTracer(name: string, version?: string): { startSpan(name: string, options?: object, context?: unknown): TelemetrySpan };
    setSpan(context: unknown, span: TelemetrySpan): unknown;
  };
  context: {
    active(): unknown;
    with<T>(context: unknown, fn: () => T): T;
  };
  propagation: { extract(context: unknown, carrier: unknown): unknown };
  metrics?: {
    getMeter(
      name: string,
      version?: string,
    ): {
      createHistogram(name: string, options?: object): TelemetryInstrument;
      createUpDownCounter(name: string, options?: object): TelemetryInstrument;
      createCounter(name: string, options?: object): TelemetryInstrument;
    };
  };
  SpanKind: { SERVER: number };
  SpanStatusCode: { ERROR: number };
}

/** Estado de uma requisição, guardado no próprio `ctx`. */
interface RequestTelemetry {
  span: TelemetrySpan;
  /** O span foi criado pelo Sashiko (e é encerrado por ele), e não pela auto-instrumentação. */
  owned: boolean;
  /** Contexto do OpenTelemetry com o span criado, para o pipeline rodar dentro dele. */
  context?: unknown;
  activeAttrs: Attributes;
}

/** Os pontos do pipeline em que o `telemetry` age; chamados pelo request-handler. */
export interface Telemetry {
  onRequest(ctx: Context): void;
  onRoute(ctx: Context, route: RouteInfo): void;
  onError(ctx: Context, err: unknown, phase: ErrorPhase): void;
  onResponse(ctx: Context, info: ResponseInfo): void;
  /** Roda o pipeline dentro do contexto do span criado pelo Sashiko (spans do usuário viram filhos). */
  run<T>(ctx: Context, fn: () => T): T;
  /** `traceId`/`spanId` do span da requisição, para o `ctx.log`. */
  spanIds(ctx: Context): { traceId: string; spanId: string } | undefined;
}

/** O estado deste módulo no `ctx`; o campo é `unknown` no `Context`, para ele não depender do telemetry. */
const state = (ctx: Context): RequestTelemetry | undefined => ctx[kTelemetry] as RequestTelemetry | undefined;

/** Versão do Sashiko, para o nome do tracer e do meter. Lida só quando o `telemetry` é usado. */
function packageVersion(): string | undefined {
  try {
    return (createRequire(import.meta.url)('../../package.json') as { version?: string }).version;
  } catch {
    return undefined;
  }
}

export function createTelemetry(api: TelemetryApi, version: string | undefined = packageVersion()): Telemetry {
  const tracer = api.trace.getTracer('sashiko', version);
  const meter = api.metrics?.getMeter('sashiko', version);
  const duration = meter?.createHistogram('http.server.request.duration', {
    unit: 's',
    description: 'Duração das requisições HTTP (sem streams).',
  });
  const streamDuration = meter?.createHistogram('sashiko.stream.duration', {
    unit: 's',
    description: 'Duração das respostas em stream (SSE, NDJSON, arquivos).',
  });
  const active = meter?.createUpDownCounter('http.server.active_requests', { unit: '{request}' });
  const aborted = meter?.createCounter('sashiko.request.aborted', { unit: '{request}' });

  return {
    onRequest(ctx) {
      const current = api.trace.getActiveSpan();
      let telemetry: RequestTelemetry;
      if (current) {
        telemetry = { span: current, owned: false, activeAttrs: { 'http.request.method': ctx.method } };
      } else {
        const parent = api.propagation.extract(api.context.active(), ctx.req.headers);
        const span = tracer.startSpan(
          ctx.method,
          { kind: api.SpanKind.SERVER, attributes: { 'http.request.method': ctx.method, 'url.path': ctx.path } },
          parent,
        );
        telemetry = { span, owned: true, context: api.trace.setSpan(parent, span), activeAttrs: { 'http.request.method': ctx.method } };
      }
      ctx[kTelemetry] = telemetry;
      active?.add?.(1, telemetry.activeAttrs);
    },

    onRoute(ctx, route) {
      const t = state(ctx);
      if (!t) return;
      t.span.updateName(`${ctx.method} ${route.path}`);
      t.span.setAttribute('http.route', route.path);
    },

    onError(ctx, err, phase) {
      const t = state(ctx);
      if (!t) return;
      t.span.recordException(err);
      t.span.addEvent?.('sashiko.error', { 'sashiko.error.phase': phase });
    },

    onResponse(ctx, info) {
      const t = state(ctx);
      if (!t) return;
      const attrs: Attributes = { 'http.request.method': ctx.method, 'http.response.status_code': info.status };
      if (info.route) attrs['http.route'] = info.route.path;
      // A regra do virtual host, não o hostname do cliente: mantém baixa a cardinalidade.
      if (info.route?.host) attrs['server.address'] = info.route.host;
      if (info.status >= 500) attrs['error.type'] = String(info.status);
      if (info.abortReason) attrs['sashiko.abort.reason'] = info.abortReason;

      active?.add?.(-1, t.activeAttrs);
      if (info.abortReason) aborted?.add?.(1, { 'sashiko.abort.reason': info.abortReason });
      (info.streaming ? streamDuration : duration)?.record?.(info.ms / 1000, attrs);

      // O span da auto-instrumentação já foi encerrado por ela; só o criado aqui recebe o fim.
      if (!t.owned) return;
      for (const [k, v] of Object.entries(attrs)) t.span.setAttribute(k, v);
      t.span.setAttribute('sashiko.outcome', info.outcome);
      if (info.ttfbMs !== undefined) t.span.setAttribute('sashiko.ttfb_ms', info.ttfbMs);
      // Convenções semânticas: só 5xx marca o span SERVER como erro; um 4xx é resposta normal.
      if (info.status >= 500) t.span.setStatus({ code: api.SpanStatusCode.ERROR });
      t.span.end();
    },

    run(ctx, fn) {
      const t = state(ctx);
      return t?.context === undefined ? fn() : api.context.with(t.context, fn);
    },

    spanIds(ctx) {
      return state(ctx)?.span.spanContext();
    },
  };
}

/**
 * `createApp({ telemetry })` com uma API falsa que segue o formato estrutural do `@opentelemetry/api`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Context, createApp, Get, Router, type TelemetryApi } from 'flowingts';

interface FakeSpan {
  name: string;
  attrs: Record<string, unknown>;
  status?: { code: number } | undefined;
  exceptions: unknown[];
  events: { name: string; attrs?: Record<string, unknown> | undefined }[];
  ended: number;
  parent?: unknown;
  options?: { kind?: number; attributes?: Record<string, unknown> } | undefined;
}

function fakeOtel(opts: { activeSpan?: boolean } = {}) {
  const spans: FakeSpan[] = [];
  const metrics: { name: string; value: number; attrs?: Record<string, unknown> | undefined }[] = [];
  let ids = 0;
  const makeSpan = (name: string, options?: FakeSpan['options'], parent?: unknown): FakeSpan & Record<string, unknown> => {
    const id = (++ids).toString(16).padStart(16, '0');
    const s: FakeSpan & Record<string, unknown> = {
      name,
      attrs: { ...(options?.attributes ?? {}) },
      exceptions: [],
      events: [],
      ended: 0,
      parent,
      options,
      setAttribute(k: string, v: unknown) {
        s.attrs[k] = v;
      },
      updateName(n: string) {
        s.name = n;
      },
      recordException(e: unknown) {
        s.exceptions.push(e);
      },
      setStatus(st: { code: number }) {
        s.status = st;
      },
      addEvent(n: string, a?: Record<string, unknown>) {
        s.events.push({ name: n, attrs: a });
      },
      end() {
        s.ended++;
      },
      spanContext: () => ({ traceId: 'a'.repeat(32), spanId: id }),
    };
    spans.push(s);
    return s;
  };
  // Contexto do OpenTelemetry: um objeto com o span ativo; `with` troca o ativo durante a função.
  let current: { span?: unknown; extracted?: unknown } = {};
  const auto = opts.activeSpan ? makeSpan('GET (auto)') : undefined;
  if (auto) current = { span: auto };
  const instrument = (name: string) => ({
    record: (value: number, attrs?: Record<string, unknown>) => void metrics.push({ name, value, attrs }),
    add: (value: number, attrs?: Record<string, unknown>) => void metrics.push({ name, value, attrs }),
  });
  const api = {
    trace: {
      getActiveSpan: () => current.span,
      getTracer: () => ({ startSpan: (n: string, o?: FakeSpan['options'], parent?: unknown) => makeSpan(n, o, parent) }),
      setSpan: (ctx: object, span: unknown) => ({ ...ctx, span }),
    },
    context: {
      active: () => current,
      with<T>(ctx: typeof current, fn: () => T): T {
        const prev = current;
        current = ctx;
        try {
          return fn();
        } finally {
          current = prev;
        }
      },
    },
    propagation: {
      extract: (ctx: object, carrier: Record<string, unknown>) => ({ ...ctx, extracted: carrier.traceparent }),
    },
    metrics: { getMeter: () => ({ createHistogram: instrument, createUpDownCounter: instrument, createCounter: instrument }) },
    SpanKind: { SERVER: 1 },
    SpanStatusCode: { ERROR: 2 },
  };
  return { api: api as unknown as TelemetryApi, spans, metrics, auto };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

@Router('/users')
class Users {
  @Get('/:id') get(ctx: Context) {
    ctx.log.info({}, 'no handler');
    return { id: ctx.params.id };
  }
  @Get('/:id/boom') boom() {
    throw new Error('quebrou');
  }
}

function logged() {
  const bindings: Record<string, unknown>[] = [];
  const logger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
    child(b: Record<string, unknown>) {
      bindings.push(b);
      return logger;
    },
  };
  return { logger, bindings };
}

describe('F-38 · createApp({ telemetry })', () => {
  it('sem span ativo: cria o span SERVER a partir do traceparent, nomeia pela rota e o encerra uma vez', async () => {
    const { api, spans, metrics } = fakeOtel();
    const { logger, bindings } = logged();
    let activeInHandler: unknown;
    @Router('/probe')
    class Probe {
      @Get('/') p() {
        activeInHandler = api.trace.getActiveSpan();
        return 'ok';
      }
    }
    const app = createApp({ logger, shutdown: false, telemetry: api });
    app.mount(Users).mount(Probe);
    await app.inject({ url: '/users/42', headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' } });
    await app.inject('/probe');
    await tick();

    const [span, probe] = spans;
    assert.equal(span!.name, 'GET /users/:id');
    assert.equal(span!.options?.kind, 1);
    assert.equal((span!.parent as { extracted?: string }).extracted, '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
    assert.equal(span!.attrs['http.route'], '/users/:id');
    assert.equal(span!.attrs['http.response.status_code'], 200);
    assert.equal(span!.attrs['flowing.outcome'], 'completed');
    assert.equal(span!.ended, 1);
    assert.equal(span!.status, undefined, '2xx não marca erro');
    assert.equal(activeInHandler, probe, 'o handler roda dentro do span criado (spans do usuário viram filhos)');
    assert.ok(
      bindings.some((b) => b.spanId === '0000000000000001' && b.traceId === 'a'.repeat(32)),
      'ctx.log com os ids do span',
    );

    const durations = metrics.filter((m) => m.name === 'http.server.request.duration');
    assert.equal(durations.length, 2);
    assert.deepEqual(durations[0]!.attrs, { 'http.request.method': 'GET', 'http.response.status_code': 200, 'http.route': '/users/:id' });
    const activeSum = metrics.filter((m) => m.name === 'http.server.active_requests').reduce((a, m) => a + m.value, 0);
    assert.equal(activeSum, 0, 'requisições ativas voltam a zero');
  });

  it('erro: exceção com a fase, status ERROR só em 5xx; 404 sem http.route e sem erro', async () => {
    const { api, spans } = fakeOtel();
    const app = createApp({ logger: false, shutdown: false, telemetry: api });
    app.mount(Users);
    await app.inject('/users/1/boom');
    await app.inject('/nada');
    await tick();
    const [boom, missing] = spans;
    assert.equal((boom!.exceptions[0] as Error).message, 'quebrou');
    assert.deepEqual(boom!.events[0], { name: 'flowing.error', attrs: { 'flowing.error.phase': 'handler' } });
    assert.deepEqual(boom!.status, { code: 2 });
    assert.equal(boom!.attrs['error.type'], '500');
    assert.equal(missing!.name, 'GET');
    assert.equal(missing!.attrs['http.route'], undefined);
    assert.equal(missing!.attrs['http.response.status_code'], 404);
    assert.equal(missing!.status, undefined);
  });

  it('com span ativo (auto-instrumentação): enriquece o existente, sem criar nem encerrar', async () => {
    const { api, spans, auto } = fakeOtel({ activeSpan: true });
    const app = createApp({ logger: false, shutdown: false, telemetry: api });
    app.mount(Users);
    await app.inject('/users/7');
    await app.inject('/users/7/boom');
    await tick();
    assert.equal(spans.length, 1, 'nenhum span novo');
    assert.equal(auto!.name, 'GET /users/:id/boom');
    assert.equal(auto!.attrs['http.route'], '/users/:id/boom');
    assert.equal((auto!.exceptions[0] as Error).message, 'quebrou');
    assert.equal(auto!.ended, 0, 'quem encerra é a auto-instrumentação');
  });

  it('sem metrics na API, só os spans', async () => {
    const { api, spans } = fakeOtel();
    delete (api as { metrics?: unknown }).metrics;
    const app = createApp({ logger: false, shutdown: false, telemetry: api });
    app.mount(Users);
    assert.equal((await app.inject('/users/1')).status, 200);
    await tick();
    assert.equal(spans[0]!.ended, 1);
  });
});

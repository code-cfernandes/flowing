/**
 * O exemplo com o SDK real do OpenTelemetry e um exportador em memória. Sem a auto-instrumentação HTTP,
 * quem cria o span da requisição é o próprio Sashiko (`telemetry: otel`).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as otel from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { buildApp } from './app.ts';

const exporter = new InMemorySpanExporter();
new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).register();

describe('exemplo opentelemetry', () => {
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
  const app = buildApp({ logger });

  it('span da requisição nomeado pela rota, com o span da aplicação como filho', async () => {
    const res = await app.inject({
      url: '/orders/42',
      headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
    });
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 20)); // o span da requisição fecha depois da resposta

    const spans = exporter.getFinishedSpans();
    const server = spans.find((s) => s.kind === otel.SpanKind.SERVER)!;
    const db = spans.find((s) => s.name === 'db.find_order')!;
    assert.equal(server.name, 'GET /orders/:id');
    assert.equal(server.attributes['http.route'], '/orders/:id');
    assert.equal(server.attributes['http.response.status_code'], 200);
    assert.equal(server.spanContext().traceId, '4bf92f3577b34da6a3ce929d0e0e4736', 'continua o trace recebido');
    assert.equal(db.spanContext().traceId, server.spanContext().traceId);
    assert.equal(db.parentSpanContext?.spanId, server.spanContext().spanId, 'o span da aplicação é filho do da requisição');
    assert.ok(
      bindings.some((b) => b.spanId === server.spanContext().spanId),
      'o ctx.log leva o spanId',
    );
  });

  it('404 sem http.route e sem marcar erro; o span continua nomeado só pelo método', async () => {
    exporter.reset();
    assert.equal((await app.inject('/nada')).status, 404);
    await new Promise((r) => setTimeout(r, 20));
    const server = exporter.getFinishedSpans().find((s) => s.kind === otel.SpanKind.SERVER)!;
    assert.equal(server.name, 'GET');
    assert.equal(server.attributes['http.route'], undefined);
    assert.equal(server.status.code, otel.SpanStatusCode.UNSET);
  });
});

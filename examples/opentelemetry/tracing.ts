/**
 * Registro do SDK do OpenTelemetry 3.x no Node. O `TracerProvider` do `@opentelemetry/sdk-trace` não tem mais o
 * `register()` do antigo `NodeTracerProvider`: o contexto assíncrono, o propagador W3C e o provider global são
 * registrados aqui, uma vez, no app e nos testes.
 */
import * as otel from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import type { TracerProvider } from '@opentelemetry/sdk-trace';

export function registerTracing(provider: TracerProvider): void {
  // Contexto por AsyncLocalStorage: o span ativo acompanha o await do handler.
  otel.context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  // traceparent/tracestate e baggage: continua o trace que chega na requisição.
  otel.propagation.setGlobalPropagator(
    new CompositePropagator({ propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()] }),
  );
  otel.trace.setGlobalTracerProvider(provider);
}

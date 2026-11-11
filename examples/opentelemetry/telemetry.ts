/**
 * SDK do OpenTelemetry: traces exportados por OTLP/HTTP (para o Jaeger do docker-compose) e a
 * auto-instrumentação HTTP. Importe este arquivo **antes** do app: a instrumentação precisa aplicar o patch
 * no `node:http` antes de o servidor ser criado.
 */
import { createRequire } from 'node:module';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { registerTracing } from './tracing.ts';

const provider = new TracerProvider({
  resource: resourceFromAttributes({ 'service.name': process.env.OTEL_SERVICE_NAME ?? 'flowing-exemplo' }),
  // OTEL_EXPORTER_OTLP_ENDPOINT muda o destino; o padrão é http://localhost:4318.
  spanProcessors: [new BatchSpanProcessor({ exporter: new OTLPTraceExporter() })],
});
registerTracing(provider);

const http = new HttpInstrumentation();
http.setTracerProvider(provider);
http.enable();
createRequire(import.meta.url)('node:http'); // aplica o patch agora, antes do app carregar

export async function shutdownTelemetry(): Promise<void> {
  await provider.shutdown(); // envia os spans pendentes
}

# OpenTelemetry com Jaeger

Traces de uma API Flowing no Jaeger, com `createApp({ telemetry: otel })`.

- **`telemetry.ts`:** configura o SDK, com o exportador OTLP/HTTP e a auto-instrumentação HTTP. Ele é importado **antes** do app, no `server.ts`.
- **Span da requisição:** a auto-instrumentação cria o span, e o Flowing o enriquece com o nome `GET /orders/:id`, o `http.route` e os erros com a fase.
- **Span da aplicação:** `db.find_order` vira filho do span da requisição, com o mesmo `traceId`.
- **Logs correlacionados:** o `ctx.log` sai com `traceId` e `spanId`.

Este exemplo é um pacote próprio do workspace (`package.json`), porque precisa do SDK do OpenTelemetry. O framework continua sem essa dependência.

```bash
docker compose -f examples/opentelemetry/docker-compose.yml up -d   # Jaeger em http://localhost:16686
pnpm exec tsx examples/opentelemetry/server.ts
curl localhost:3000/orders/42
```

Os spans aparecem no Jaeger como serviço `flowing-exemplo` (`OTEL_SERVICE_NAME` muda o nome).

Testes: `node --import tsx --test examples/opentelemetry/app.test.ts`. Eles usam o SDK real com um exportador em memória, sem precisar do Jaeger.

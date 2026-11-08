# Exemplos

Projetos completos em [`examples/`](https://github.com/code-cfernandes/sashiko/tree/main/examples). Os cinco primeiros têm testes que rodam no CI (`pnpm test:examples`), então acompanham a API da versão atual. O app de usuários é verificado por um script de cenários com `curl`.

| Exemplo                                                                                                 | O que mostra                                                                                                        |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [CRUD com SQLite](https://github.com/code-cfernandes/sashiko/tree/main/examples/crud-sqlite)            | Schemas na entrada e na saída, status pelo schema, Problem Details e injeção pelo construtor, com o `node:sqlite`   |
| [Autenticação com JWT](https://github.com/code-cfernandes/sashiko/tree/main/examples/auth-jwt)          | Login com senha em hash, `bearerAuth`, guard de papel e as recusas de token (adulterado, expirado, `alg: none`)     |
| [Contratos em Zod](https://github.com/code-cfernandes/sashiko/tree/main/examples/contracts-zod)         | `contracts.standard()`: schemas Zod como contrato, valor tratado pelo Zod, saída filtrada e OpenAPI gerado pelo Zod |
| [Chat com SSE](https://github.com/code-cfernandes/sashiko/tree/main/examples/sse-chat)                  | `ctx.sse()`, envio para todas as conexões, reconexão com `Last-Event-ID` e limpeza no `onClose`                     |
| [OpenTelemetry com Jaeger](https://github.com/code-cfernandes/sashiko/tree/main/examples/opentelemetry) | `telemetry: otel`, auto-instrumentação HTTP, spans da aplicação como filhos e logs com `traceId`                    |
| [App de usuários](https://github.com/code-cfernandes/sashiko/tree/main/examples/app-users)              | CRUD, mapeamento manual, guards, CORS, rate limit, logger, herança e um serializador CSV                            |

Cada exemplo separa o app (`app.ts`, sem `listen()`) do servidor (`server.ts`). O teste usa o mesmo app pelo `app.inject()`, sem rede, ou com `listen(0)` quando precisa de uma conexão real.

O app de usuários traz um script que percorre todos os cenários com `curl`:

```bash
pnpm dev
bash examples/app-users/scenarios.sh
```

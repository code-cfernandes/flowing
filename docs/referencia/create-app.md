# createApp(options)

| Opção             | Padrão                | Descrição                                                                                  |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `bodyLimit`       | `1048576`             | Tamanho máximo do body JSON, em bytes                                                      |
| `queryMaxKeys`    | `1000`                | Máximo de pares lidos da query string                                                      |
| `requireSchemas`  | `false`               | Exige schemas de body e de resposta no registro das rotas                                  |
| `securityHeaders` | `'api'`               | `'api'`, `'web'`, um objeto de opções, ou `false` para desligar                            |
| `serializers`     | —                     | Serializadores por content type, para responder em outros formatos                         |
| `shutdown`        | SIGINT/SIGTERM, 10s   | `signals`, `timeoutMs`, `drainDelayMs`, `onShutdown`, `exit`; `false` desliga              |
| `protoPoisoning`  | `'error'`             | Body com `__proto__`/`constructor.prototype`: `'error'` (400) ou `'remove'`                |
| `trustProxy`      | `false`               | `true` ou o número de proxies: `ctx.ip`/`host`/`protocol` passam a usar os `X-Forwarded-*` |
| `allowedHosts`    | qualquer host válido  | Lista de hosts (string ou RegExp); os demais recebem 400                                   |
| `formatError`     | Problem Details       | `(problem, ctx) => corpo`, para personalizar o corpo de todos os erros                     |
| `timeouts`        | 30s / 10s / 5s        | `requestTimeout`, `headersTimeout`, `keepAliveTimeout`                                     |
| `logger`          | `consoleLogger()`     | Logger compatível com pino; `false` desliga                                                |
| `logRequests`     | `false`               | Log de cada requisição concluída (`request completed`) ou cancelada (`request aborted`)    |
| `telemetry`       | —                     | O `@opentelemetry/api` da aplicação: spans e métricas HTTP                                 |
| `requestId`       | header `x-request-id` | `header`, `trustIncoming`, `generate`                                                      |

Métodos do app: `use()`, `mount()`, `group()`, `static()`, `health()`, `openapi()`, `openapiDocument()`, `onRequest()`, `onError()`, `onSend()`, `onResponse()`, `onClose()`, `listen()`, `close()`, `callback()`, `inject()`, `log`. O `mount()` devolve um `MountedGroup`, com os verbos do mapeamento manual e os mesmos métodos do app, para continuar o encadeamento.

O body só é lido como JSON quando o `Content-Type` é `application/json` ou `application/*+json`.

# Erros

```ts
import { badRequest, forbidden, HttpError, internal, notFound, unauthorized } from 'flowingts';

throw notFound('user not found');
throw new HttpError(409, 'email taken', 'CONFLICT');
throw new HttpError(402, 'Saldo insuficiente', 'NO_FUNDS', { type: 'https://exemplo.dev/problems/no-funds', details: { balance: 3 } });
throw new HttpError(503, 'Maintenance', 'MAINT', { expose: true });
```

Todos os erros, inclusive 404, 405, validação e `Host` inválido, saem no formato **Problem Details** ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)), com `Content-Type: application/problem+json`:

```json
{ "type": "about:blank", "title": "Not Found", "status": 404, "detail": "user not found", "code": "NOT_FOUND" }
```

| Campo     | Conteúdo                                                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`    | URI do tipo do problema (opção `type` do `HttpError`); `about:blank` por padrão                                                                                                                                               |
| `title`   | Frase do status (`Not Found`)                                                                                                                                                                                                 |
| `status`  | Status HTTP                                                                                                                                                                                                                   |
| `detail`  | A mensagem do erro; omitido quando igual ao título ou em 5xx não expostos                                                                                                                                                     |
| `code`    | Código estável para o cliente tratar: `VALIDATION_ERROR`, `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `NOT_ACCEPTABLE`, `INVALID_HOST`, `FORBIDDEN`, `RATE_LIMITED`, `CSRF_ORIGIN`, `CSRF_TOKEN`… |
| `details` | Dados extras: os erros de validação, `allowed` no 405, `available` no 406                                                                                                                                                     |

- **Erros 4xx:** a mensagem vai para o cliente.
- **Erros 5xx e erros comuns** (`throw new Error(...)`): a resposta é sempre `{ "type": "about:blank", "title": "Internal Server Error", "status": 500 }`. O erro completo vai para o log, com `reqId`. Para mostrar uma mensagem de 5xx ao cliente, use `expose: true`.
- **`formatError`:** para outro formato (legado, um envelope próprio, o request id no corpo), passe `createApp({ formatError: (problem, ctx) => ({ error: problem.detail ?? problem.title, code: problem.code }) })`. O retorno sai como `application/json`. Se a função lançar, o erro é logado e o problema padrão é enviado.
- **`app.onError((err, ctx, phase) => ...)`:** roda antes da resposta padrão, para enviar o erro a um APM, por exemplo. `phase` diz em que etapa a requisição estava: `middleware`, `guard`, `validation` (inclui a leitura do body), `handler` ou `response`. No modelo onion, um erro lançado depois do `await next()` de um middleware aparece com a etapa mais recente. Se o próprio handler falhar, o app não cai: o erro é logado e a resposta padrão é enviada.

# Exemplo: app-users

API de usuários que demonstra os recursos do Sashiko: CRUD com schemas, validação, segurança e herança de classes de rotas.

## Rodar

```bash
pnpm dev                               # sobe em http://127.0.0.1:3000 com watch
bash examples/app-users/scenarios.sh   # em outro terminal: percorre todos os cenários
```

Variáveis de ambiente:

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `CORS_ORIGINS` | `http://localhost:5173` | Origens permitidas, separadas por vírgula |
| `RATE_LIMIT` | `100` | Requisições por minuto por IP (use `5` para ver o 429) |
| `ADMIN_API_KEY` | `dev-admin-key` | Chave exigida em `/admin/stats` |
| `NODE_ENV=production` | — | Liga o HSTS |
| `DEBUG_ERRORS=1` | — | Loga os erros no `onError` |
| `LOG_LEVEL=debug` | `info` | Nível do logger (mostra o `@timer()`) |

## Estrutura

```
server.ts                  configuração do app (segurança, CORS, rate limit, timeouts)
src/routes/users.ts        CRUD /users
src/routes/admin.ts        /health (base) e /admin (herda /health)
src/guards/api-key.ts      guard que exige o header x-api-key (aplicado no server.ts)
src/schema/                schemas TypeBox
src/types/                 tipos derivados dos schemas
src/store/                 UserRepository em memória, injetado nas classes de rotas
```

## Rotas

| Método | Rota | Demonstra |
|---|---|---|
| GET | `/users?limit&offset` | Query com coerção e defaults |
| GET/HEAD | `/users/:id` | Params com `format: uuid`; HEAD automático |
| POST | `/users` | Body estrito, `additionalProperties: false`, 201 |
| PATCH | `/users/:id` | `Type.Partial` com `minProperties: 1` |
| DELETE | `/users/:id` | 204 |
| POST | `/users/:id/greet` | Handler async medido com `@timer()` |
| GET | `/health`, `/admin/health` | Herança entre classes de rotas |
| GET | `/admin/stats` | Guard `apiKeyGuard` aplicado no `server.ts` (401) e header documentado por schema |
| GET | `/public/users`, `/public/users/:id` | A mesma classe montada de novo, só leitura (`only`) |
| GET | `/admin/boom` | Erro interno sem vazar detalhes ao cliente |

## Cenários cobertos pelo `scenarios.sh`

| Spec | Cenário |
|---|---|
| B-01 | JSON malformado → 400 |
| B-02 | Erros de validação com `details` por campo |
| F-01 / F-28 | Guard de `/admin` aplicado em `app.mount(…, { guards })`: sem chave → 401, inclusive nas rotas herdadas |
| F-28 | `/public/users` é a `UserRoutes` com `prefix` e `only`; `POST /public/users` → 405 |
| F-02 | Handlers com `Context<typeof schemas>`, sem casts |
| F-06 | `X-Request-Id` em toda resposta; logs com `reqId` |
| F-09 | `await app.listen()` e `app.close()` no shutdown |
| B-06 | Body sem coerção de tipos; query com coerção |
| B-05 | `POST /users` responde 201 sem `ctx.status()`, pelo único 2xx do schema |
| B-09 | `/admin/health` herdado de `HealthRoutes` |
| B-10 | Controllers recebem o `UserRepository` pelo construtor (`server.ts`) |
| B-12 | Body acima de 64KB → 413 + `Connection: close` |
| F-08 | HEAD sem corpo e OPTIONS com `Allow` |
| S-01 | Preflight CORS de origem permitida e de origem desconhecida |
| S-04 | Headers de segurança em toda resposta |
| S-05 | `/admin/boom` responde só `Internal Server Error` |
| S-06 | Rate limit (subir com `RATE_LIMIT=5`) |
| S-07 | `requireSchemas: true` e campo extra no body → 400 |

> Rotas POST exigem schema de body por causa do `requireSchemas`, por isso o `/greet` espera `{}` no corpo.

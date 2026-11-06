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
src/serializers/csv.ts     serializador CSV plugável (registrado no server.ts)
src/middlewares/cache.ts   cache em memória usando ctx.sentBody (aplicado em /public/users)
src/types/                 tipos derivados dos schemas
src/store/                 UserRepository em memória, injetado nas classes de rotas
```

## Rotas

| Método | Rota | Demonstra |
|---|---|---|
| GET | `/users?limit&offset` | Query com coerção e defaults; JSON ou CSV pelo `Accept` |
| GET/HEAD | `/users/:id` | Params com `format: uuid`; HEAD automático |
| POST | `/users` | Body estrito, `additionalProperties: false`, 201 |
| PATCH | `/users/:id` | `Type.Partial` com `minProperties: 1` |
| DELETE | `/users/:id` | 204 |
| POST | `/users/:id/greet` | Handler async medido com `@timer()` |
| GET | `/health`, `/admin/health` | Herança entre classes de rotas |
| GET | `/openapi.json`, `/docs` | Documento OpenAPI 3.1 gerado das rotas e Swagger UI |
| GET | `/admin/stats` | Guard `apiKeyGuard` aplicado no `server.ts` (401) e header documentado por schema |
| GET | `/public/users`, `/public/users/:id` | A mesma classe montada de novo, só leitura (`only`), com cache (`X-Cache: MISS/HIT`) |
| GET | `/users/export.csv` | Mapeamento manual de um método sem verbo, com guard só nessa rota; `return` de string com `contentType: 'text/csv'` |
| GET | `/users/by-id/:id` | Mapeamento manual: alias de `GET /users/:id` |
| GET | `/admin/boom` | Erro interno sem vazar detalhes ao cliente |

## Cenários cobertos pelo `scenarios.sh`

| Área | Cenário |
|---|---|
| CRUD | Criar (201 sem `ctx.status()`, pelo único 2xx do schema), listar com paginação, buscar, atualizar, saudar (async) e remover (204) |
| Validação | Erros com `details` por campo; campo extra no body → 400; body sem coerção de tipos, query com coerção; id que não é UUID → 400 |
| Erros | JSON malformado → 400; e-mail duplicado → 400; erro interno em `/admin/boom` responde só `Internal Server Error` |
| Limites | Body acima de 64KB → 413 com `Connection: close`; rate limit → 429 (subir com `RATE_LIMIT=5`) |
| Rotas automáticas | HEAD sem corpo; OPTIONS com `Allow`; método não suportado → 405 |
| Mapeamento manual | `/users/export.csv` só com a API key (401 sem ela); `/users/by-id/:id` como alias |
| Composição | Guard de `/admin` aplicado em `app.mount(…, { guards })`: sem chave → 401, inclusive na rota herdada `/admin/health`; `/public/users` é a mesma `UserRoutes` com `prefix` e `only`, e `POST` nela → 405 |
| Segurança | Headers de segurança em toda resposta; preflight CORS de origem permitida e de origem desconhecida |
| Formatos | `GET /users` com `Accept: text/csv` responde em CSV, sem campos extras; `Accept: application/xml` → 406 |
| Logs | `X-Request-Id` em toda resposta, reaproveitado quando enviado; logs com `reqId` no terminal do servidor |

Outros recursos aparecem no código: `Context<typeof schemas>` sem casts, `UserRepository` injetado pelo construtor, `requireSchemas: true` e o encerramento gracioso nos sinais do processo, sem código manual (`shutdown` no `createApp`).

> Rotas POST exigem schema de body por causa do `requireSchemas`, por isso o `/greet` espera `{}` no corpo.

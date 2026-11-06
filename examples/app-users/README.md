# Exemplo: app-users

API de usuários que demonstra os recursos do PicoDecor: CRUD com schemas, validação, segurança e herança de controllers.

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

## Estrutura

```
server.ts                  configuração do app (segurança, CORS, rate limit, timeouts)
src/controller/User.ts     CRUD /users
src/controller/Admin.ts    /health (base) e /admin (herda /health)
src/schema/                schemas TypeBox
src/types/                 tipos derivados dos schemas
src/store/                 "banco" em memória
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
| GET | `/health`, `/admin/health` | Herança de controllers |
| GET | `/admin/stats` | Header obrigatório (`x-api-key`) validado por schema |
| GET | `/admin/boom` | Erro interno sem vazar detalhes ao cliente |

## Cenários cobertos pelo `scenarios.sh`

| Spec | Cenário |
|---|---|
| B-01 | JSON malformado → 400 |
| B-02 | Erros de validação com `details` por campo |
| B-03 | Header obrigatório ausente → 400 |
| B-06 | Body sem coerção de tipos; query com coerção |
| B-09 | `/admin/health` herdado de `HealthController` |
| B-12 | Body acima de 64KB → 413 + `Connection: close` |
| F-08 | HEAD sem corpo e OPTIONS com `Allow` |
| S-01 | Preflight CORS de origem permitida e de origem desconhecida |
| S-04 | Headers de segurança em toda resposta |
| S-05 | `/admin/boom` responde só `Internal Server Error` |
| S-06 | Rate limit (subir com `RATE_LIMIT=5`) |
| S-07 | `requireSchemas: true` e campo extra no body → 400 |

> Rotas POST exigem schema de body por causa do `requireSchemas`, por isso o `/greet` espera `{}` no corpo.

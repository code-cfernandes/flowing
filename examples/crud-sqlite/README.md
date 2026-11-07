# CRUD com SQLite

Tarefas (`/tasks`) com o `node:sqlite`, embutido no Node 22.13+, sem dependência externa.

- **Schemas na entrada e na saída:** `title` de 1 a 200 caracteres, sem campos extras; `PATCH` com pelo menos um campo; `?done=true` convertido para boolean.
- **Status pelo schema:** `POST` responde 201, `DELETE` 204, e um id inexistente gera 404 em Problem Details.
- **Composição explícita:** o repositório entra pelo construtor de `TaskRoutes`, montado no `buildApp()`. O `onClose` fecha o banco.

```bash
DB_FILE=tasks.db pnpm exec tsx examples/crud-sqlite/server.ts
curl -X POST localhost:3000/tasks -H 'content-type: application/json' -d '{"title":"comprar café"}'
curl 'localhost:3000/tasks?done=false'
```

Testes: `node --import tsx --test examples/crud-sqlite/app.test.ts`, ou `pnpm test:examples` para todos.

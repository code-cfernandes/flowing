# Contratos em Zod

Rotas com schemas Zod, pelo motor `contracts.standard()`: os mesmos schemas que um projeto já compartilha com o site e o app viram o contrato da API.

- **Entrada:** o Zod valida e devolve o valor já tratado (`trim`, `default`), que vira o `ctx.body`. O `z.coerce` converte o id do path.
- **Saída:** o schema do status filtra a resposta. O registro salvo tem `email` e `criadoEm`, que não saem.
- **Tipos:** `ctx.body` e `ctx.params` têm os tipos do próprio Zod.
- **OpenAPI:** o `toJSONSchema` do Zod gera o documento, com a página `/docs`.

```bash
pnpm exec tsx examples/contracts-zod/server.ts   # http://localhost:3000/docs
```

Testes: `node --import tsx --test examples/contracts-zod/app.test.ts`, ou `pnpm test:examples` para todos.

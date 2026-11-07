# Schemas: validação, serialização e tipos

Os schemas da rota (`params`, `query`, `headers`, `body` e `response`) são escritos em [TypeBox](https://github.com/sinclairzx81/typebox) (JSON Schema) e podem ser declarados de duas formas equivalentes:

```ts
@Get('/:id', byId)                  // enxuta: no próprio verbo
getUser(ctx: Context<typeof byId>) {}

@Get('/:id')                        // verbosa: em um decorator separado
@Schema(byId)
getUser(ctx: Context<typeof byId>) {}
```

As duas formas podem conviver no mesmo método quando declaram partes diferentes (por exemplo, `params` no verbo e `response` no `@Schema`). Declarar a mesma parte nos dois lugares gera erro.

```ts
const list = {
  query: Type.Object({
    limit: Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
    tag: Type.Optional(Type.Array(Type.String())),
  }),
  response: { 200: Type.Array(User) },
} satisfies RouteSchemas;

@Get('/', list)
list(ctx: Context<typeof list>) {
  ctx.query.limit; // number (já convertido de "20" e com default)
  ctx.query.tag;   // string[] | undefined (?tag=a&tag=b ou ?tag=a)
}
```

**Path e `params` conferidos**

- **Em compilação:** com schema de `params` no verbo, todo parâmetro do path precisa estar no schema. `@Get('/:userId', { params: Type.Object({ id: Type.String() }) })` é erro de tipo (`Missing in params schema: "userId"`).
- **No registro:** o `app.mount()` confere path x schema nos dois sentidos, já com o prefixo do `@Router`/`mount` (que pode ter parâmetros, como `'/orgs/:org'`), também para `@Schema` separado e rotas manuais. Também recusa path malformado: `/:`, nome repetido, regex sem fechamento, `*` fora do fim.
- **Sem schema:** `Context<'/:org/users/:id'>` tipa `ctx.params` pelo path (`{ org: string; id: string }`). O utilitário `PathParams<'/:a/:b'>` dá `'a' | 'b'`.

**Validação**

- **Tipagem:** com `Context<typeof schemas>`, `ctx.params`, `ctx.query` e `ctx.body` são tipados a partir do schema. Sem o genérico, `Context` usa tipos genéricos.
- **Coerção:** params, query e headers chegam como texto e são convertidos para o tipo declarado. O **body não sofre coerção**: `"30"` não vira `30`.
- **Defaults:** valores `default` são aplicados.
- **Ordem:** headers → params → query → body. O primeiro erro gera um 400 com os detalhes:

  ```json
  {
    "type": "about:blank", "title": "Bad Request", "status": 400,
    "detail": "Invalid body", "code": "VALIDATION_ERROR",
    "details": [{ "path": "/email", "message": "must match format \"email\"" }]
  }
  ```

- **Campos extras:** use `additionalProperties: false` nos bodies para rejeitar campos não previstos. É a proteção contra mass assignment.

**Resposta**

- **Filtro:** o schema de `response` serializa a saída com `fast-json-stringify`, e **campos não declarados não saem**, por exemplo `password`.
- **Status padrão:** se só existe um 2xx declarado (como `201`), ele é o status padrão; não é preciso chamar `ctx.status(201)`.
- **Status sem schema:** se a rota declara schemas de resposta e o handler devolve um status sem schema, a resposta é **500**, com o motivo no log, e não o objeto sem filtro.
- **Sem corpo:** retornar `undefined` (por exemplo, num 204) dispensa schema.

**Modo estrito.** `createApp({ requireSchemas: true })` falha na inicialização se alguma rota não tiver schema de `response`, ou se um POST/PUT/PATCH não tiver schema de `body`.

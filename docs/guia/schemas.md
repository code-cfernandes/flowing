---

## aprenda: Escrever o contrato de uma rota e como ele valida a entrada, tipa o ctx, filtra a resposta e gera o OpenAPI.

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

## Entrada e saída são schemas diferentes

O contrato de uma rota não obriga a resposta a espelhar a entrada. `params`, `query`, `headers` e `body` descrevem o que chega; `response` descreve, **para cada status**, o que sai. Um POST que recebe um pedido inteiro e responde só com uma mensagem:

```ts
const Order = Type.Object({ product: Type.String(), quantity: Type.Integer({ minimum: 1 }) }, { additionalProperties: false });

const submit = {
  body: Order, // entrada: o pedido inteiro
  response: { 202: Type.Object({ message: Type.String() }) }, // saída: só a mensagem
} satisfies RouteSchemas;

@Post('/', submit)
submit(ctx: Context<typeof submit>) {
  queue.push(ctx.body);
  return { message: 'Pedido recebido' }; // 202: o único status de sucesso declarado
}
```

- **Só o status, sem corpo:** `response: { 204: Type.Null() }`, e o handler não retorna nada.
- **Proteção:** se o handler devolver mais do que o schema da saída declara (o pedido salvo, com `id` e um custo interno), só os campos declarados saem.
- **Mais de um desfecho de sucesso** (`201` quando cria, `200` quando já existia): declare os dois e escolha com `ctx.status()`. Ele só aceita os status declarados, e o corpo precisa corresponder ao schema escolhido.
- **Na saída, o schema serializa e filtra, mas não é uma validação completa:** a garantia é que nada além do declarado sai. A validação rigorosa (`minLength`, `format`…) é a da entrada.

Para não repetir campos, derive um schema do outro com o TypeBox:

```ts
const Task = Type.Object({ id: Type.Integer(), title: Type.String(), done: Type.Boolean() });
const CreateTask = Type.Omit(Task, ['id', 'done']); // POST: só o que o cliente envia
const UpdateTask = Type.Partial(Type.Omit(Task, ['id'])); // PATCH: tudo opcional, sem o id
```

**Modo estrito.** `createApp({ requireSchemas: true })` falha na inicialização se alguma rota não tiver schema de `response`, ou se um POST/PUT/PATCH não tiver schema de `body`.

## Zod, Valibot e ArkType: o motor dos contratos

O motor padrão do FlowingTS é o `contracts.native()`, para schemas TypeBox. Para escrever os contratos em Zod, Valibot ou ArkType (qualquer biblioteca que implemente o [Standard Schema](https://standardschema.dev)), declare o motor no app:

```ts
import { z } from 'zod';
import { type Context, contracts, createApp, Post, Router, type RouteSchemas } from 'flowingts';

const app = createApp({
  contracts: contracts.standard({ toJSONSchema: (schema) => z.toJSONSchema(schema as z.ZodType) }),
});

const criar = {
  body: z.object({ nome: z.string().trim().min(2), email: z.email(), ativo: z.boolean().default(true) }),
  response: { 201: z.object({ id: z.number(), nome: z.string() }) },
} satisfies RouteSchemas;

@Router('/membros')
class MembroRoutes {
  @Post('/', criar)
  criar(ctx: Context<typeof criar>) {
    return salvar(ctx.body); // ctx.body tem o tipo do schema Zod, já com o trim e o default aplicados
  }
}
```

- **Um motor por app.** Sem a opção, vale o `contracts.native()`. Com `contracts.standard()`, todo schema precisa ser Standard Schema: um schema TypeBox numa rota (ou um Zod num app nativo) falha no registro, com a dica de configuração. Não há mistura no mesmo app.
- **Valor transformado:** o que o schema devolve (com `trim`, `default`, `transform`) substitui `ctx.body`, `ctx.query` e `ctx.params`. Os headers são validados, mas `ctx.req.headers` não é trocado.
- **Sem coerção automática:** params e query chegam como texto. Use os conversores da biblioteca: `z.coerce.number()`, `z.coerce.boolean()`.
- **Validação assíncrona** (`refine` com `async`) funciona na entrada. Na resposta, o schema precisa validar de forma síncrona.
- **Resposta:** o schema do status valida e filtra a saída (o `z.object` remove o que não foi declarado; `.passthrough()` desliga isso) e o valor vai com `JSON.stringify`. Uma saída que não corresponde ao schema vira 500, sem enviar o objeto.
- **Erros** no mesmo formato do motor nativo: 400 `VALIDATION_ERROR`, com os caminhos em JSON Pointer (`/email`).
- **OpenAPI:** com `toJSONSchema`, os schemas entram no documento; sem, as rotas aparecem com schemas vazios.
- **Path:** no motor nativo, os parâmetros do path são conferidos contra o schema de `params` no registro; com Standard Schema, essa conferência não é feita (a validação na requisição continua).

# Sashiko

Micro-framework HTTP para Node.js com **decorators nativos (TC39)**, **schema-first** e **seguro por padrão**.

> **Sashiko** (刺し子) é uma técnica japonesa de bordado em que os pontos decorativos também **reforçam** o tecido. É a ideia do framework: os decorators organizam a API e, ao mesmo tempo, trazem validação e proteções seguras por padrão.

Sashiko combina a flexibilidade do **Fastify** e do **Express** (middlewares simples, partes plugáveis, pouca cerimônia) com a organização em classes do **NestJS**, mantendo o núcleo pequeno: `node:http` direto e só cinco dependências de runtime.

```ts
import { type Context, createApp, Post, Router, type RouteSchemas, Type } from 'sashiko';

const User = Type.Object({ id: Type.String(), name: Type.String() });
const create = {
  body: Type.Object({ name: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  response: { 201: User },
} satisfies RouteSchemas;

@Router('/users')
class UserRoutes {
  @Post('/', create)
  create(ctx: Context<typeof create>) {
    return { id: crypto.randomUUID(), name: ctx.body.name }; // ctx.body tipado; responde 201
  }
}

const app = createApp().mount(UserRoutes);
await app.listen({ port: 3000 });
```

## Sumário

- [Requisitos e instalação](#requisitos-e-instalação)
- [Rotas](#rotas)
- [Registro e composição: `app.mount()`](#registro-e-composição-appmount)
- [Mapeamento manual](#mapeamento-manual)
- [Schemas: validação, serialização e tipos](#schemas-validação-serialização-e-tipos)
- [Respostas e o `ctx`](#respostas-e-o-ctx)
- [Middlewares e guards](#middlewares-e-guards)
- [Hooks de ciclo de vida](#hooks-de-ciclo-de-vida)
- [Erros](#erros)
- [OpenAPI e `/docs`](#openapi-e-docs)
- [Segurança](#segurança)
- [Logs e request id](#logs-e-request-id)
- [Ciclo de vida e testes](#ciclo-de-vida-e-testes)
- [Referência: `createApp(options)`](#referência-createappoptions)
- [Princípios](#princípios)

## Requisitos e instalação

- **Node.js 22+**
- **TypeScript 5.2+**, com decorators **padrão**. **Não** use `experimentalDecorators` nem `emitDecoratorMetadata`: se estiverem ligados, o Sashiko lança um erro dizendo como corrigir. Por isso ele não convive no mesmo projeto com bibliotecas que exigem decorators legados (NestJS, TypeORM…).
- ESM (`"type": "module"`).

```bash
pnpm add sashiko
```
*(O TypeBox já vem incluído e re-exportado como `Type`, `Static` e `TSchema`)*

`tsconfig.json` mínimo:

```jsonc
{
  "compilerOptions": {
    "target": "es2022",
    "module": "nodenext",
    "strict": true
  }
}
```

Importe `sashiko` **antes** de declarar as classes de rotas: o pacote instala o shim de `Symbol.metadata`, necessário para os decorators guardarem as rotas. Com `import { Router } from 'sashiko'` isso já acontece.

## Rotas

As rotas ficam em classes marcadas com `@Router`, a "permissão" para o app usar a classe, que também define o prefixo. Verbo e path ficam no método:

```ts
@Router('/users')
class UserRoutes {
  @Get('/')         list() {}
  @Get('/:id')      get(ctx: Context) { return { id: ctx.params.id }; }
  @Post('/')        create() {}
  @Put('/:id')      replace() {}
  @Patch('/:id')    update() {}
  @Delete('/:id')   remove(ctx: Context) { ctx.status(204); }
}
```

- **HEAD e OPTIONS automáticos:** toda rota `GET` responde a `HEAD`, sem corpo. `OPTIONS` responde 204 com o header `Allow`.
- **405 e 404:** um método não suportado num path existente recebe 405 com `Allow`; um path inexistente recebe 404.
- **Herança:** uma subclasse (com seu próprio `@Router`) herda as rotas, os middlewares e os guards do pai, com o próprio prefixo, e pode sobrescrever handlers. A classe base não é alterada.

## Registro e composição: `app.mount()`

`app.mount()` é a única porta de entrada. Ele aceita a classe (com construtor sem argumentos) ou uma **instância**, que é como as dependências chegam, sem container de DI. No **ponto de composição** (`server.ts`) você decide como expor cada classe, sem mexer nela:

```ts
const repo = new UserRepository(db);
const userRoutes = new UserRoutes(repo);

app
  .mount(HealthRoutes)
  .mount(userRoutes)                                                     // como declarado
  .mount(userRoutes, { prefix: '/v2/users' })                            // a mesma instância em outro prefixo
  .mount(userRoutes, { prefix: '/public/users', only: (r) => [r.list, r.get] }) // exposição parcial
  .mount(new AdminRoutes(repo), { middlewares: [authenticate], guards: [isAdmin] }); // regras para o grupo
```

| Opção | Efeito |
|---|---|
| `prefix` | Substitui o prefixo do `@Router` |
| `only` / `except` | Registra só os métodos selecionados, ou todos menos esses: `(r) => [r.list, r.get]`. O seletor é checado pelo TypeScript; usar os dois juntos gera erro |
| `auto` | `false` registra só as [rotas manuais](#mapeamento-manual). Padrão: `true` |
| `middlewares` | Valem para todas as rotas do grupo; rodam antes dos `@Middlewares` da classe |
| `guards` | Valem para todas as rotas do grupo; rodam antes dos `@Guards` da classe |

Erros de registro aparecem na inicialização, com mensagem clara:
- classe sem `@Router`;
- seletor em `only`/`except` que não aponta para um método de rota;
- a mesma classe registrada duas vezes com o mesmo prefixo.

> **Por que `mount` e não `register`?** O método monta um grupo de rotas sob um prefixo, quantas vezes for preciso, como o `koa-mount` e os routers do Express. No Fastify, `register` significa plugin encapsulado, e o Sashiko não tem um sistema de plugins (veja abaixo).

### Grupos: `app.group()`

Para aplicar prefixo, middlewares e guards a **várias** classes de uma vez:

```ts
app.group({ prefix: '/v2', middlewares: [authenticate], guards: [isAdmin] }, (g) =>
  g.mount(UserRoutes).mount(new OrderRoutes(db)),
);
// GET /v2/users, GET /v2/orders…
```

- **Prefixos se somam:** grupo, depois o prefixo do `mount()` ou do `@Router`, depois o path do método. O prefixo pode ter parâmetros (`'/orgs/:org'`), conferidos contra o schema de `params`.
- **Ordem de execução:** grupos (de fora para dentro) → `mount()` → classe → método → rota manual. Vale para middlewares e para guards.
- **Encadeamento:** dentro do callback, `g.mount(A).mount(B)` e `.get(...)` continuam no grupo. Grupos podem ser aninhados (`g.group(...)`).
- **O callback é síncrono.** Faça o trabalho assíncrono antes (`const db = await connect()`).
- **Fora do escopo:** middlewares globais (`app.use()`) e hooks (`onError`, `onSend`…) continuam no app.

**Pacotes reutilizáveis, sem sistema de plugins.** Uma função que recebe o app basta, sem API nova, registro de nomes nem ciclo de vida próprio:

```ts
export function audit(app: SashikoApp, opts: { store: AuditStore }) {
  return app
    .group({ prefix: '/audit', guards: [isAdmin] }, (g) => g.mount(new AuditRoutes(opts.store)))
    .onClose(() => opts.store.flush());
}

audit(app, { store });
```

## Mapeamento manual

Depois do `mount`, os verbos `.get()`, `.post()`, `.put()`, `.patch()` e `.delete()` mapeiam um método da classe para um path que ela não declara: um alias, um endpoint legado, um export. O path é relativo ao prefixo do grupo, e o método é escolhido por um **seletor**, checado pelo TypeScript:

```ts
@Router('/users')
class UserRoutes {
  @Get('/:id', byId)  getUser(ctx: Context<typeof byId>) {}
  @Schema(csv)        exportCsv(ctx: Context<typeof csv>) {}  // sem verbo: só por mapeamento manual
  private findOr404() {}                                       // sem decorator: nunca pode ser exposto
}

app
  .mount(new UserRoutes(repo))
  .get('/legacy/:id', (r) => r.getUser)                                 // GET /users/legacy/:id
  .get('/export.csv', (r) => r.exportCsv, { middlewares: [cache()], guards: [isAuditor] })
  .mount(HealthRoutes);                                                 // o encadeamento continua
```

- **Seletor:** funciona com instância (inclusive inline, `mount(new X(repo))`) e com a classe. "Ir para a definição" e renomear no editor funcionam.
- **Permissão por método:** só podem ser mapeados métodos com algum decorator do Sashiko (verbo, `@Schema`, `@Middlewares` ou `@Guards`). Um método sem decorator gera erro no registro.
- **Regras herdadas:** a rota manual usa os schemas e os `@Middlewares`/`@Guards` do método, e as regras do grupo.
- **Opções da rota:** `{ middlewares, guards }` em objeto, e não uma lista de funções, para que middleware, guard e seletor nunca se confundam.
- **Só mapeamento manual:** `mount(x, { auto: false })` não registra as rotas declaradas na classe.

## Schemas: validação, serialização e tipos

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

## Respostas e o `ctx`

O valor retornado pelo handler vira a resposta. Sem schema de resposta, o formato vem do tipo do valor:

| Retorno | Resposta |
|---|---|
| objeto, array, número, booleano, `null` | `application/json` |
| `string` | `text/plain; charset=utf-8`, sem aspas |
| `Buffer` / `Uint8Array` | `application/octet-stream` |
| `Readable` (stream) | enviado em stream |
| `undefined` | sem corpo |

Um `Content-Type` definido no handler (`ctx.header('Content-Type', ...)`) sempre prevalece.

### Outros formatos: `contentType`, serializadores e `Accept`

Uma entrada de `response` pode declarar o tipo de conteúdo. Um schema sem `contentType` continua sendo JSON:

```ts
// CSV cru: o `return` de uma string sai como está
@Get('/export.csv', { response: { 200: { contentType: 'text/csv', schema: Type.String() } } })
exportCsv() { return 'id,name\n1,Ana\n'; }

// Vários formatos: o cliente escolhe pelo Accept (q-values e curingas); sem Accept, vale o primeiro
@Get('/', { response: { 200: { contentType: ['application/json', 'application/yaml'], schema: Type.Array(User) } } })
list() { return users; }
```

Objetos em formatos que não são JSON passam por um **serializador** registrado no app. A biblioteca é escolha sua:

```ts
import YAML from 'yaml';
createApp({ serializers: { 'application/yaml': (data) => YAML.stringify(data) } });
```

- **Campos não declarados nunca saem, em nenhum formato.** Antes do serializador, a saída é validada contra o schema e os campos extras são removidos (sobre uma cópia). Se não bater com o schema, a resposta é 500, com o motivo no log.
- **Sem formato aceitável:** a resposta é `406 Not Acceptable`, com os tipos disponíveis. Rotas com mais de um tipo enviam `Vary: Accept`.
- **Sem serializador:** um objeto num tipo sem serializador registrado gera 500, com a instrução no log.
- **Erros:** continuam em JSON.

### Dois estilos, um pipeline

Dá para responder com `return` ou com envio imperativo (`ctx.json()`, `ctx.send()`, `ctx.text()`). Os dois passam pelo **mesmo** pipeline: schema do status, remoção de campos não declarados, status padrão, negociação e serializadores. A resposta é idêntica.

```ts
const job = {
  body: Type.Object({ async: Type.Boolean() }),
  response: { 200: Type.Object({ result: Type.String() }), 202: Type.Object({ jobId: Type.String() }) },
} satisfies RouteSchemas;

@Post('/jobs', job)
run(ctx: Context<typeof job>) {
  if (ctx.body.async) return ctx.status(202).json({ jobId: enqueue() });  // status decidido em runtime
  return { result: process() };                                           // status padrão
}
```

**O `status()` tipa o corpo.** Com schemas de resposta, `ctx.status()` só aceita os status declarados, e o `json()`/`send()` seguinte exige o corpo daquele status. `ctx.status(202).json({ result })` e `ctx.status(201)` são erros de compilação no exemplo acima.

Estilo recomendado:
- `return` para o caso comum;
- `ctx.status(x).json(body)` quando o status é decidido em runtime;
- `throw` para erros.

Os schemas de resposta valem para o que o **handler** envia. Middlewares e guards que respondem antes dele (manutenção, cache, 401), as respostas de erro e os 404/405 do framework não passam pelo schema da rota.

### Helpers do `ctx`

| Método | Uso |
|---|---|
| `ctx.status(code)` | Define o status |
| `ctx.header(name, value)` | Define um header da resposta |
| `ctx.get(name)` | Lê um header da requisição |
| `ctx.json(data)` | Envia JSON pelo pipeline (schema, filtro, status padrão) |
| `ctx.text(str)` | `text/plain; charset=utf-8`, pelo pipeline |
| `ctx.send(body, contentType?)` | Qualquer corpo pelo pipeline: string, bytes, stream ou objeto (negociado pelo `Accept`) |
| `ctx.redirect(url, status?)` | 302 por padrão; aceita 301, 303, 307, 308 |
| `ctx.cookies` | Cookies da requisição (objeto sem protótipo) |
| `ctx.setCookie(name, value, opts?)` | Adiciona um `Set-Cookie`, com `HttpOnly`, `Secure`, `SameSite=Lax` e `Path=/` por padrão |
| `ctx.clearCookie(name, opts?)` | Remove um cookie (use o mesmo `path` e `domain` da criação) |
| `ctx.throw(status, message)` | Lança um `HttpError` |

Outros campos: `ctx.params`, `ctx.query`, `ctx.body`, `ctx.state`, `ctx.id`, `ctx.log`, `ctx.sentBody`, `ctx.sentType`, `ctx.ip`, `ctx.host`, `ctx.hostname`, `ctx.protocol`, `ctx.method`, `ctx.path`, `ctx.url`, `ctx.req` e `ctx.res`.

> ⚠️ `ctx.send` não faz escape de HTML; escape o conteúdo dinâmico antes. `ctx.redirect` com uma URL vinda do usuário abre um *open redirect*; valide o destino.

## Middlewares e guards

Middlewares seguem o modelo do Koa: `(ctx, next) => Promise<void>`.

```ts
app.use(async (ctx, next) => {
  const started = Date.now();
  await next();
  ctx.log.debug({ ms: Date.now() - started }, 'done');
});
```

Por classe ou por método, use `@Middlewares` e `@Guards`; para um grupo inteiro ou uma rota manual, use as opções `middlewares` e `guards`, com os mesmos nomes em todos os níveis. Um guard retorna `true` para seguir, `false` para responder 403, ou lança um `HttpError` (por exemplo, `unauthorized()` para 401).

```ts
declare module 'sashiko' {
  interface ContextState { user?: { id: string; role: 'admin' | 'user' } }  // ctx.state tipado
}

const authenticate: Middleware = async (ctx, next) => {
  ctx.state.user = await verifyToken(ctx.get('authorization'));
  await next();
};
const isAdmin: Guard = (ctx) => ctx.state.user?.role === 'admin';

@Middlewares(authenticate)
@Router('/admin')
class AdminRoutes {
  @Guards(isAdmin)
  @Delete('/users/:id')
  remove() {}
}
```

**Ordem de execução:**

```
globais → mount.middlewares → @Middlewares (classe → método) → rota manual.middlewares
        → mount.guards → @Guards (classe → método) → rota manual.guards
        → validação → handler
```

**Ordem dos decorators no código.** `@Router`, `@Get`/`@Post`/…, `@Schema`, `@Middlewares` e `@Guards` só registram metadata, então a posição entre eles não muda o comportamento; a única regra é que vários `@Middlewares` (ou `@Guards`) executam na ordem em que aparecem, de cima para baixo. Já decorators que **envolvem** o método, como `@timer()`, medem tudo o que estiver abaixo deles.

Os guards rodam **antes** da validação: quem não tem acesso recebe 401/403, e não um 400 que revelaria o formato esperado.

## Hooks de ciclo de vida

Para o que acontece **antes** do handler (autenticação, rate limit, preparar o `ctx.state`), use middlewares. Os hooks cobrem o resto:

```ts
app
  .onSend((ctx, payload) => { ctx.header('ETag', etag(payload.body)); })   // antes de escrever (síncrono)
  .onResponse((ctx, { status, ms }) => metrics.observe(ctx.path, status, ms)) // depois do envio
  .onClose(async () => { await db.close(); });                              // em qualquer close()
```

- **`onSend`:** roda imediatamente antes de escrever uma resposta com corpo (exceto streams), inclusive erros e 404. É **síncrono**, como a escrita do pipeline. Pode alterar headers ou devolver `{ body, contentType }` novos. Se lançar, o erro é logado e a resposta original é enviada.
- **`onResponse`:** roda depois do envio, com o status e a duração. Pode ser assíncrono, porque não atrasa o cliente, e erros são só logados.
- **`onClose`:** roda em qualquer `close()` (sinal, teste, código), depois que o servidor fecha e antes do `shutdown.onShutdown`. Todos os hooks rodam mesmo se algum falhar, e o `close()` rejeita ao final.

**Cache com middleware.** Depois do `await next()`, `ctx.sentBody` e `ctx.sentType` contêm o corpo exatamente como foi enviado, já filtrado pelo schema:

```ts
const cache = (ttlMs: number): Middleware => async (ctx, next) => {
  const hit = store.get(ctx.url.href);
  if (hit) return void ctx.header('X-Cache', 'HIT').send(hit.body, hit.type);
  ctx.header('X-Cache', 'MISS');   // headers antes do next(): depois dele a resposta já foi enviada
  await next();
  if (ctx.res.statusCode === 200 && ctx.sentBody) store.set(ctx.url.href, { body: ctx.sentBody, type: ctx.sentType! });
};
app.mount(products, { middlewares: [cache(60_000)] });
```

| Fastify | Sashiko |
|---|---|
| `onRequest`, `preHandler` | middlewares (`app.use`, `mount({ middlewares })`, `@Middlewares`) |
| `onError` | `app.onError` |
| `onSend` | `app.onSend` (síncrono) |
| `onResponse` | `app.onResponse` |
| `onClose` | `app.onClose` |

## Erros

```ts
import { badRequest, forbidden, HttpError, internal, notFound, unauthorized } from 'sashiko';

throw notFound('user not found');
throw new HttpError(409, 'email taken', 'CONFLICT');
throw new HttpError(402, 'Saldo insuficiente', 'NO_FUNDS', { type: 'https://exemplo.dev/problems/no-funds', details: { balance: 3 } });
throw new HttpError(503, 'Maintenance', 'MAINT', { expose: true });
```

Todos os erros, inclusive 404, 405, validação e `Host` inválido, saem no formato **Problem Details** ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)), com `Content-Type: application/problem+json`:

```json
{ "type": "about:blank", "title": "Not Found", "status": 404, "detail": "user not found", "code": "NOT_FOUND" }
```

| Campo | Conteúdo |
|---|---|
| `type` | URI do tipo do problema (opção `type` do `HttpError`); `about:blank` por padrão |
| `title` | Frase do status (`Not Found`) |
| `status` | Status HTTP |
| `detail` | A mensagem do erro; omitido quando igual ao título ou em 5xx não expostos |
| `code` | Código estável para o cliente tratar: `VALIDATION_ERROR`, `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `NOT_ACCEPTABLE`, `INVALID_HOST`, `FORBIDDEN`, `RATE_LIMITED`, `CSRF_ORIGIN`, `CSRF_TOKEN`… |
| `details` | Dados extras: os erros de validação, `allowed` no 405, `available` no 406 |

- **Erros 4xx:** a mensagem vai para o cliente.
- **Erros 5xx e erros comuns** (`throw new Error(...)`): a resposta é sempre `{ "type": "about:blank", "title": "Internal Server Error", "status": 500 }`. O erro completo vai para o log, com `reqId`. Para mostrar uma mensagem de 5xx ao cliente, use `expose: true`.
- **`formatError`:** para outro formato (legado, um envelope próprio, o request id no corpo), passe `createApp({ formatError: (problem, ctx) => ({ error: problem.detail ?? problem.title, code: problem.code }) })`. O retorno sai como `application/json`. Se a função lançar, o erro é logado e o problema padrão é enviado.
- **`app.onError(handler)`:** roda antes da resposta padrão, para enviar o erro a um APM, por exemplo. Se o próprio handler falhar, o app não cai: o erro é logado e a resposta padrão é enviada.

## OpenAPI e `/docs`

```ts
createApp()
  .mount(UserRoutes)
  .openapi({
    info: { title: 'Minha API', version: '1.0.0' },
    servers: [{ url: 'https://api.exemplo.dev' }],
    docs: true,               // Swagger UI em /docs (desligado por padrão)
    guards: [isAdmin],        // só para /openapi.json e /docs
  });
```

- **Nada é exposto sem `app.openapi()`.** Para só gerar o arquivo, sem rota, use `app.openapiDocument()`.
- **`GET /openapi.json`:** documento OpenAPI 3.1 gerado das rotas registradas. É montado na primeira requisição, então pode chamar `openapi()` antes ou depois dos `mount()`.
- **`GET /docs`:** Swagger UI, **opt-in** com `docs: true` (ou `docs: '/ref'` para outro path). A versão é fixada e carregada do CDN com SRI (o navegador confere o hash do arquivo), e a página tem CSP própria, com `nonce` no script.
- **Acesso:** `middlewares` e `guards` funcionam como no `mount()` e valem só para o documento e a página, no path que estiver configurado. As duas rotas também passam pelos middlewares globais (`app.use()`).
- **Opções:** `path` muda o endereço do documento.
- **`app.openapiDocument()`:** devolve o objeto, para gravar em arquivo, gerar clientes ou testar no CI.
- **O que entra no documento:**

  | Origem | Vira |
  |---|---|
  | Path (`/:id(^\\d+)`) | `/{id}` |
  | `params`, `query`, `headers` | `parameters`, com `required` |
  | `body` | `requestBody` em JSON |
  | `response` | uma resposta por status, com os `contentType` declarados |
  | Erros | resposta `default` com o schema `ProblemDetails`; com `formatError`, só a descrição |
  | Classe e método | `tags` e `operationId` (`UserRoutes.getUser`) |

- **Limites:** só schemas JSON Schema (TypeBox) entram como estão. Rotas sem schema de resposta aparecem com um `200` genérico. Em produção, proteja as rotas com `guards`/`middlewares` ou gere só o arquivo com `openapiDocument()`.

## Segurança

Ligado por padrão:

| Proteção | Detalhe |
|---|---|
| Headers de segurança | `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin`. HSTS é opt-in. Para servir páginas, use `securityHeaders: 'web'` (CSP `default-src 'self'`, `X-Frame-Options: SAMEORIGIN`). |
| Limite de body | 1 MiB (`bodyLimit`). Recusado já pelo `Content-Length`, com a conexão fechada. |
| Timeouts | `requestTimeout` 30s, `headersTimeout` 10s, `keepAliveTimeout` 5s (contra Slowloris). |
| Query | Até 1000 pares (`queryMaxKeys`); `__proto__`, `constructor` e `prototype` são descartados. |
| Body JSON | `__proto__` e `constructor.prototype` em qualquer nível, inclusive com escapes `\u`, recebem 400 (`PROTO_POISONING`). Com `protoPoisoning: 'remove'`, as chaves são descartadas e a requisição segue. |
| Logs | `authorization`, `cookie`, `password`, `token`, `apiKey` e afins saem como `[REDACTED]` no logger padrão. |
| Erros 5xx | Sem detalhes para o cliente. |
| Request id | Ids recebidos só são aceitos se forem seguros (contra log injection). |
| Host e path | `Host` malformado → 400. O path vem do request-target com base fixa: `//evil.com/x` continua sendo esse path e não muda o host. `ctx.url` usa o host validado. |

Opt-in:

```ts
import { cors, createApp, csrf, rateLimit } from 'sashiko';

createApp({
  requireSchemas: true,
  securityHeaders: { strictTransportSecurity: true }, // só atrás de HTTPS
})
  .use(cors({ origin: ['https://app.exemplo.com', 'https://*.exemplo.dev'], credentials: true }))
  .use(rateLimit({ max: 100, windowMs: 60_000 }));     // 429 + Retry-After
```

- **`cors()`:** a origem é obrigatória, sem default permissivo. Responde ao preflight com 204 e envia `Vary: Origin`. Combinar `origin: '*'` com `credentials: true` gera erro.
- **Regras de origem e de host, seguras por padrão** (as mesmas para `cors()` e `allowedHosts`):

  | Regra | Casa com | Não casa com |
  |---|---|---|
  | `'https://app.exemplo.com'` | a mesma origem, depois de normalizar (maiúsculas, porta padrão, barra final) | `http://…`, outra porta, `app.exemplo.com.atacante.com` |
  | `'https://*.exemplo.dev'` | qualquer subdomínio | `exemplo.dev` em si, `exemplo.dev.atacante.com` |
  | RegExp | a string **inteira**, como se tivesse `^…$` | qualquer casamento parcial |
  | função | o que ela decidir, sob sua responsabilidade | — |

  - **RegExp sem âncora não vira brecha:** `/app\.exemplo\.com/` não aceita `app.exemplo.com.atacante.com`. As flags `g`, `y` e `m` são descartadas, então o resultado não muda entre requisições.
  - **Prefira o curinga à RegExp:** uma regex mal escrita pode ser lenta com uma entrada maliciosa (ReDoS).
  - **Regras inválidas falham na inicialização,** por exemplo uma origem sem esquema (`'app.exemplo.com'`).
- **Autenticação: `bearerAuth()` e `basicAuth()`.** São guards prontos. A verificação é sua: JWT com a biblioteca que preferir, sessão no banco, lista de chaves. O usuário devolvido vai para `ctx.state.user`.

  ```ts
  const auth = bearerAuth({ verify: async (token) => (await sessions.find(token)) ?? false });
  app.group({ guards: [auth] }, (g) => g.mount(UserRoutes));

  const painel = basicAuth({ verify: (user, pass) => safeEqual(user, 'admin') && safeEqual(pass, process.env.ADMIN_PASS!) });
  ```
  Credencial ausente, malformada ou recusada recebe **o mesmo** 401, com `WWW-Authenticate` e sem dizer o motivo. Para comparar segredos, use `safeEqual()`, que tem tempo constante e também não revela o tamanho. Use o `basicAuth` só sobre HTTPS.
- **`rateLimit()`:** guarda os contadores em memória por padrão. Para várias instâncias, implemente `RateLimitStore` (Redis etc.).
- **Cookies:** `ctx.setCookie()` usa `HttpOnly`, `Secure`, `SameSite=Lax` e `Path=/` por padrão (os navegadores aceitam `Secure` em `http://localhost`). Nome, `path` e `domain` são validados contra injeção de atributos, e os prefixos `__Host-` e `__Secure-` têm as regras conferidas.
- **`csrf()`: ative sempre que a autenticação usar cookies.** Métodos que alteram estado (todos menos GET, HEAD e OPTIONS) vindos de outra origem recebem 403. A checagem usa o `Sec-Fetch-Site` e, na falta dele, compara o `Origin` com a própria origem. Requisições sem esses headers (curl, servidor a servidor) passam, porque não há navegador para anexar os cookies da vítima.

  ```ts
  app.use(csrf());                                              // checagem de origem
  app.use(csrf({ trustedOrigins: ['https://app.exemplo.com'] })); // front em outra origem
  app.use(csrf({ token: true }));                               // + double-submit token
  ```
  Com `token: true`, o middleware cria o cookie `__Host-csrf` (legível pelo JS, `SameSite=Strict`) e o expõe em `ctx.state.csrfToken`; o cliente o devolve no header `X-CSRF-Token`. Rotas GET nunca devem alterar estado.
- **Atrás de proxy:** `ctx.ip`, `ctx.host` e `ctx.protocol` usam o socket e o `Host` por padrão. Com `trustProxy: 1` (o número de proxies à frente do app) ou `true` (toda a cadeia), passam a usar o `X-Forwarded-For`, o `-Host` e o `-Proto`. Só ligue isso atrás de um proxy que reescreve esses headers, porque o cliente pode forjá-los.
- **`allowedHosts`:** com `allowedHosts: ['api.exemplo.com', '*.exemplo.dev']`, qualquer outro `Host` recebe 400. Protege contra host header injection e DNS rebinding. Um host sem porta aceita qualquer porta; com porta (`'api.exemplo.com:8443'`), exige a porta exata.
- **Links absolutos** (reset de senha, redirects): prefira uma URL base da configuração em vez do host pedido pelo cliente.

## Logs e request id

```ts
import pino from 'pino';

createApp({ logger: pino(), logRequests: true });
```

- **Logger:** compatível com o pino (`info(obj, msg)`, `child()`). O padrão, `consoleLogger({ level })`, usa o `console`. `logger: false` desliga tudo.
- **Request id:** cada requisição recebe `ctx.id`, também devolvido no header `X-Request-Id`. Um id recebido nesse header é reaproveitado se for seguro; isso é configurável em `requestId`.
- **`ctx.log`:** já inclui o `reqId`: `ctx.log.info({ userId }, 'user created')`.
- **`logRequests: true`:** registra método, path, status e duração de cada requisição.
- **Dados sensíveis:** headers e body nunca são logados automaticamente. O que você logar passa pelo `redact` do logger padrão. As chaves `authorization`, `cookie`, `set-cookie`, `x-api-key`, `password`, `secret`, `token`, `access_token`, `refresh_token` e afins, em qualquer nível, saem como `[REDACTED]`. A comparação ignora maiúsculas, `-` e `_`.

  ```ts
  createApp({ logger: consoleLogger({ redact: ['cpf', 'cardNumber'] }) }); // soma às chaves padrão; false desliga
  ```
  Com o pino, configure o [`redact`](https://getpino.io/#/docs/redaction) dele.

## Ciclo de vida e testes

```ts
const app = createApp().mount(UserRoutes);

await app.listen({ port: 3000, host: '0.0.0.0' }); // resolve quando está ouvindo; SIGINT/SIGTERM já tratados

await app.listen({ port: 443, host: '0.0.0.0', tls: { key, cert } }); // HTTPS, com o mesmo ciclo de vida

// Servidor próprio (http2 em modo compat, outro transporte…): aqui o ciclo de vida é seu
https.createServer(tlsOptions, app.callback()).listen(443);
```

### HTTPS

```ts
import { readFileSync } from 'node:fs';

await app.listen({
  port: 443,
  host: '0.0.0.0',
  tls: {
    key: readFileSync('/etc/ssl/privkey.pem'),
    cert: readFileSync('/etc/ssl/fullchain.pem'),
    // pfx + passphrase também funcionam; minVersion: 'TLSv1.3' para exigir TLS 1.3
  },
});
```

- **Mesmo ciclo de vida do HTTP:** timeouts contra Slowloris, encerramento gracioso nos sinais, `close()` e `onClose`. `ctx.protocol` vira `https`, e os cookies `Secure` funcionam.
- **TLS 1.2 é o mínimo.** SSLv3, TLS 1.0 e 1.1 não são aceitos, nem por configuração.
- **Certificados inválidos falham no `listen()`,** e não no primeiro cliente.
- **Vários domínios (SNI):** cada domínio recebe o seu certificado no handshake.

  ```ts
  tls: {
    key, cert,                                         // principal: domínios sem entrada própria
    sni: {
      'api.exemplo.com': { key: apiKey, cert: apiCert },
      '*.exemplo.dev':   { key: devKey, cert: devCert }, // um nível: a.exemplo.dev, não a.b.exemplo.dev
    },
  }
  ```
  Sem certificado principal, um domínio fora da lista não completa o handshake. Para recusar o domínio também na camada HTTP, combine com `allowedHosts`.
- **Renovação sem reiniciar:** `app.reloadTLS({ key, cert, sni })` troca os certificados. As conexões novas usam os novos, e as abertas continuam com os antigos. Um certificado inválido lança erro e mantém os atuais. É o ponto de integração para um cliente ACME externo, como Let's Encrypt via certbot:

  ```ts
  watch('/etc/ssl/fullchain.pem', () => app.reloadTLS({ key: readFileSync(keyPath), cert: readFileSync(certPath) }));
  ```

**TLS no app ou no proxy?** Na maioria dos deploys, o TLS termina no proxy ou no load balancer (Caddy, Nginx, Traefik). Nesse caso, use `app.listen()` em HTTP na rede interna, com `trustProxy: 1` e `allowedHosts`. Use `listen({ tls })` quando não houver proxy à frente ou quando o TLS precisar ir até o processo.

**Fora do core, por decisão:** emissão e renovação automática de certificados (ACME) e gerenciamento de DNS. São responsabilidades de ferramentas próprias, integradas pelo `reloadTLS()`.

### Planos futuros

- **HTTP/2** (com fallback para HTTP/1.1 via ALPN). Ainda não é suportado pelo `listen()`. O modo de compatibilidade do Node muda partes do ciclo de vida: o shutdown usa GOAWAY, e não `Connection: close`; não existem `requestTimeout` nem `headersTimeout`; os limites de streams precisam de padrão seguro. Por isso, entra numa versão própria. Até lá, o proxy à frente pode falar HTTP/2 com o cliente e HTTP/1.1 com o app.
- **Virtual hosts:** `mount(X, { host })` e `group({ host })`, para servir domínios diferentes no mesmo app.
- **mTLS:** certificado do cliente (`requestCert`) e `ctx.clientCertificate`.

**Encerramento gracioso, sem código.** Com `listen()`, um SIGINT ou SIGTERM faz o app parar de aceitar conexões, esperar as requisições em andamento (com prazo) e sair com código 0:

```ts
createApp({
  shutdown: {
    timeoutMs: 10_000,                        // prazo para as requisições em andamento (padrão)
    onShutdown: async () => { await db.close(); }, // depois que o servidor fecha
  },
});
```

- **Segundo sinal:** força a saída com código 1 (o Ctrl+C duplo). Um erro no `onShutdown` também sai com 1.
- **Vários apps no mesmo processo:** compartilham um único listener por sinal e fecham todos juntos.
- **Limpeza:** os listeners são removidos no `close()`, então testes com vários `listen(0)` não acumulam listeners. O `inject()` e o `callback()` não registram nada.
- **Opções:** `signals` muda os sinais tratados, `exit: false` fecha sem chamar `process.exit`, e `shutdown: false` desliga tudo (por exemplo, se outra ferramenta controla o processo).

**Testes sem rede.** `app.inject()` executa a requisição em memória:

```ts
const res = await app.inject({ method: 'POST', url: '/users', body: { name: 'Ana' } });
assert.equal(res.status, 201);
assert.equal(res.json<{ name: string }>().name, 'Ana');
```

## Referência: `createApp(options)`

| Opção | Padrão | Descrição |
|---|---|---|
| `bodyLimit` | `1048576` | Tamanho máximo do body JSON, em bytes |
| `queryMaxKeys` | `1000` | Máximo de pares lidos da query string |
| `requireSchemas` | `false` | Exige schemas de body e de resposta no registro das rotas |
| `securityHeaders` | `'api'` | `'api'`, `'web'`, um objeto de opções, ou `false` para desligar |
| `serializers` | — | Serializadores por content type, para responder em outros formatos |
| `shutdown` | SIGINT/SIGTERM, 10s | `signals`, `timeoutMs`, `onShutdown`, `exit`; `false` desliga |
| `protoPoisoning` | `'error'` | Body com `__proto__`/`constructor.prototype`: `'error'` (400) ou `'remove'` |
| `trustProxy` | `false` | `true` ou o número de proxies: `ctx.ip`/`host`/`protocol` passam a usar os `X-Forwarded-*` |
| `allowedHosts` | qualquer host válido | Lista de hosts (string ou RegExp); os demais recebem 400 |
| `formatError` | Problem Details | `(problem, ctx) => corpo`, para personalizar o corpo de todos os erros |
| `timeouts` | 30s / 10s / 5s | `requestTimeout`, `headersTimeout`, `keepAliveTimeout` |
| `logger` | `consoleLogger()` | Logger compatível com pino; `false` desliga |
| `logRequests` | `false` | Log de cada requisição concluída |
| `requestId` | header `x-request-id` | `header`, `trustIncoming`, `generate` |

Métodos do app: `use()`, `mount()`, `openapi()`, `openapiDocument()`, `onError()`, `onSend()`, `onResponse()`, `onClose()`, `listen()`, `close()`, `callback()`, `inject()`, `log`. O `mount()` devolve um `MountedGroup`, com os verbos do mapeamento manual e os mesmos métodos do app, para continuar o encadeamento.

O body só é lido como JSON quando o `Content-Type` é `application/json` ou `application/*+json`.

## Princípios

1. **Micro:** núcleo pequeno, com cinco dependências de runtime (`@sinclair/typebox`, `ajv`, `ajv-formats`, `fast-json-stringify`, `find-my-way`). O TypeBox é re-exportado (`Type`, `Static`, `TSchema`), então não precisa ser instalado à parte.
2. **Só decorators padrão (TC39):** sem `reflect-metadata`.
3. **Schema-first:** o schema é a fonte da validação, da serialização e dos tipos.
4. **Seguro por padrão:** desligar uma proteção é sempre explícito.
5. **Node nativo:** `node:http` direto.
6. **Explícito em vez de mágico:** rotas e dependências registradas à mão, no ponto de composição, sem varredura de arquivos.

**Extensões:** quando um recurso tem alternativas populares, o core traz uma implementação leve e um ponto de extensão; a biblioteca externa fica a critério do seu projeto. Estão planejados um parser de query plugável (para usar `qs`) e um validador plugável (Zod, Valibot e ArkType via Standard Schema).

**Fora do escopo:** container de DI, módulos e providers; decorators de parâmetro (`@Body`, `@Param`), porque a interface é o `ctx`; interceptors, pipes e exception filters como conceitos separados; ORM, views e SSR, CLI geradora, GraphQL e WebSockets no core, compatibilidade com middlewares do Express, Bun, Deno e edge (por enquanto).

## Exemplo completo

[`examples/app-users`](examples/app-users) traz CRUD, composição com `app.mount()`, mapeamento manual, guards, CORS, rate limit, logger, herança e injeção de dependências, além de um script que percorre todos os cenários:

```bash
pnpm dev
bash examples/app-users/scenarios.sh
```

## Desenvolvimento

```bash
pnpm install
pnpm test            # node:test + tsx
pnpm test:coverage   # com limites mínimos de cobertura
pnpm typecheck
pnpm build           # dist/
```

Mudanças notáveis estão no [CHANGELOG](CHANGELOG.md). Para reportar uma vulnerabilidade e conhecer a política de dependências, veja o [SECURITY.md](SECURITY.md).

## Licença

[ISC](LICENSE)

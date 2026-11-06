# Sashiko

Micro-framework HTTP para Node.js com **decorators nativos (TC39)**, **schema-first** e **seguro por padrão**.

> **Sashiko** (刺し子) é uma técnica japonesa de bordado em que os pontos decorativos também **reforçam** o tecido. É a ideia do framework: os decorators organizam a API e, ao mesmo tempo, trazem validação e proteções seguras por padrão.

Sashiko combina a flexibilidade do **Fastify** e do **Express** (middlewares simples, partes plugáveis, pouca cerimônia) com a organização em classes do **NestJS**, mantendo o núcleo pequeno: `node:http` direto e só quatro dependências de runtime.

```ts
import { Type } from '@sinclair/typebox';
import { type Context, createApp, Post, Router, type RouteSchemas } from 'sashiko';

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
- [Erros](#erros)
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
pnpm add sashiko @sinclair/typebox
```

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

> **Por que `mount` e não `register`?** O método monta um grupo de rotas sob um prefixo, quantas vezes for preciso, como o `koa-mount` e os routers do Express. No Fastify, `register` significa plugin encapsulado, e esse nome fica reservado para um futuro sistema de plugins.

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

**Validação**
- **Tipagem:** com `Context<typeof schemas>`, `ctx.params`, `ctx.query` e `ctx.body` são tipados a partir do schema. Sem o genérico, `Context` usa tipos genéricos.
- **Coerção:** params, query e headers chegam como texto e são convertidos para o tipo declarado. O **body não sofre coerção**: `"30"` não vira `30`.
- **Defaults:** valores `default` são aplicados.
- **Ordem:** headers → params → query → body. O primeiro erro gera um 400 com os detalhes:

  ```json
  { "error": "Invalid body", "details": [{ "path": "/email", "message": "must match format \"email\"" }] }
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
| `ctx.throw(status, message)` | Lança um `HttpError` |

Outros campos: `ctx.params`, `ctx.query`, `ctx.body`, `ctx.state`, `ctx.id`, `ctx.log`, `ctx.ip`, `ctx.host`, `ctx.hostname`, `ctx.protocol`, `ctx.method`, `ctx.path`, `ctx.url`, `ctx.req` e `ctx.res`.

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

## Erros

```ts
import { badRequest, forbidden, HttpError, internal, notFound, unauthorized } from 'sashiko';

throw notFound('user not found');                       // 404 { "error": "user not found" }
throw new HttpError(409, 'email taken', 'CONFLICT');
throw new HttpError(503, 'Maintenance', 'MAINT', { expose: true });
```

- **Erros 4xx:** a mensagem vai para o cliente.
- **Erros 5xx e erros comuns** (`throw new Error(...)`): a resposta é sempre `{"error":"Internal Server Error"}`. O erro completo vai para o log, com `reqId`. Para mostrar uma mensagem de 5xx ao cliente, use `expose: true`.
- **`app.onError(handler)`:** roda antes da resposta padrão, para enviar o erro a um APM, por exemplo. Se o próprio handler falhar, o app não cai: o erro é logado e a resposta padrão é enviada.

## Segurança

Ligado por padrão:

| Proteção | Detalhe |
|---|---|
| Headers de segurança | `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin`. HSTS é opt-in. Para servir páginas, use `securityHeaders: 'web'` (CSP `default-src 'self'`, `X-Frame-Options: SAMEORIGIN`). |
| Limite de body | 1 MiB (`bodyLimit`). Recusado já pelo `Content-Length`, com a conexão fechada. |
| Timeouts | `requestTimeout` 30s, `headersTimeout` 10s, `keepAliveTimeout` 5s (contra Slowloris). |
| Query | Até 1000 pares (`queryMaxKeys`); `__proto__`, `constructor` e `prototype` são descartados. |
| Erros 5xx | Sem detalhes para o cliente. |
| Request id | Ids recebidos só são aceitos se forem seguros (contra log injection). |
| Host e path | `Host` malformado → 400. O path vem do request-target com base fixa: `//evil.com/x` continua sendo esse path e não muda o host. `ctx.url` usa o host validado. |

Opt-in:

```ts
import { cors, createApp, rateLimit } from 'sashiko';

createApp({
  requireSchemas: true,
  securityHeaders: { strictTransportSecurity: true }, // só atrás de HTTPS
})
  .use(cors({ origin: ['https://app.exemplo.com', /\.exemplo\.dev$/], credentials: true }))
  .use(rateLimit({ max: 100, windowMs: 60_000 }));     // 429 + Retry-After
```

- **`cors()`:** a origem é obrigatória, sem default permissivo. Aceita string, lista, RegExp ou função. Responde ao preflight com 204 e envia `Vary: Origin`. Combinar `origin: '*'` com `credentials: true` gera erro.
- **`rateLimit()`:** guarda os contadores em memória por padrão. Para várias instâncias, implemente `RateLimitStore` (Redis etc.).
- **Cookies e CSRF:** ainda não há proteção de CSRF embutida. Se a autenticação usar cookies, valide `Origin` num middleware e use `SameSite=Lax` ou `Strict`.
- **Atrás de proxy:** `ctx.ip`, `ctx.host` e `ctx.protocol` usam o socket e o `Host` por padrão. Com `trustProxy: 1` (o número de proxies à frente do app) ou `true` (toda a cadeia), passam a usar o `X-Forwarded-For`, o `-Host` e o `-Proto`. Só ligue isso atrás de um proxy que reescreve esses headers, porque o cliente pode forjá-los.
- **`allowedHosts`:** com `allowedHosts: ['api.exemplo.com', /\.exemplo\.dev$/]`, qualquer outro `Host` recebe 400. Protege contra host header injection e DNS rebinding.
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
- **Dados sensíveis:** headers e body nunca são logados automaticamente.

## Ciclo de vida e testes

```ts
const app = createApp().mount(UserRoutes);

await app.listen({ port: 3000, host: '0.0.0.0' }); // resolve quando está ouvindo; SIGINT/SIGTERM já tratados

// Servidor próprio (HTTPS, http2 em modo compat…): aqui o ciclo de vida é seu
https.createServer(tlsOptions, app.callback()).listen(443);
```

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
| `trustProxy` | `false` | `true` ou o número de proxies: `ctx.ip`/`host`/`protocol` passam a usar os `X-Forwarded-*` |
| `allowedHosts` | qualquer host válido | Lista de hosts (string ou RegExp); os demais recebem 400 |
| `timeouts` | 30s / 10s / 5s | `requestTimeout`, `headersTimeout`, `keepAliveTimeout` |
| `logger` | `consoleLogger()` | Logger compatível com pino; `false` desliga |
| `logRequests` | `false` | Log de cada requisição concluída |
| `requestId` | header `x-request-id` | `header`, `trustIncoming`, `generate` |

Métodos do app: `use()`, `mount()`, `onError()`, `listen()`, `close()`, `callback()`, `inject()`, `log`. O `mount()` devolve um `MountedGroup`, com os verbos do mapeamento manual e os mesmos métodos do app, para continuar o encadeamento.

O body só é lido como JSON quando o `Content-Type` é `application/json` ou `application/*+json`.

## Princípios

1. **Micro:** núcleo pequeno, com quatro dependências de runtime (`ajv`, `ajv-formats`, `fast-json-stringify`, `find-my-way`).
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

Mudanças notáveis estão no [CHANGELOG](CHANGELOG.md).

## Licença

[ISC](LICENSE)

# PicoDecor

Micro-framework HTTP para Node.js com **decorators nativos (TC39)**, **schema-first** e **seguro por padrão**.

PicoDecor combina a flexibilidade do **Fastify** e do **Express** (middlewares simples, partes plugáveis, pouca cerimônia) com a organização em controllers do **NestJS**, mantendo o núcleo pequeno: `node:http` direto e só quatro dependências de runtime.

```ts
import { Type } from '@sinclair/typebox';
import { type Context, Controller, createApp, Get, Post, type RouteSchemas, Schema } from 'picodecor';

const User = Type.Object({ id: Type.String(), name: Type.String() });
const create = {
  body: Type.Object({ name: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  response: { 201: User },
} satisfies RouteSchemas;

@Controller('/users')
class UserController {
  @Post('/')
  @Schema(create)
  create(ctx: Context<typeof create>) {
    return { id: crypto.randomUUID(), name: ctx.body.name }; // ctx.body tipado; responde 201
  }
}

const app = createApp().controllers([UserController]);
await app.listen({ port: 3000 });
```

## Sumário

- [Requisitos e instalação](#requisitos-e-instalação)
- [Controllers e rotas](#controllers-e-rotas)
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
- **TypeScript 5.2+**, com decorators **padrão**. **Não** use `experimentalDecorators` nem `emitDecoratorMetadata`: se estiverem ligados, o PicoDecor lança um erro dizendo como corrigir. Por isso ele não convive no mesmo projeto com bibliotecas que exigem decorators legados (NestJS, TypeORM…).
- ESM (`"type": "module"`).

```bash
pnpm add picodecor @sinclair/typebox
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

Importe `picodecor` **antes** de declarar controllers: o pacote instala o shim de `Symbol.metadata`, necessário para os decorators guardarem as rotas. Com `import { Controller } from 'picodecor'` isso já acontece.

## Controllers e rotas

```ts
@Controller('/users')
class UserController {
  @Get('/')         list() {}
  @Get('/:id')      get(ctx: Context) { return { id: ctx.params.id }; }
  @Post('/')        create() {}
  @Put('/:id')      replace() {}
  @Patch('/:id')    update() {}
  @Delete('/:id')   remove(ctx: Context) { ctx.status(204); }
}

createApp().controllers([UserController]);
```

- **HEAD e OPTIONS automáticos:** toda rota `GET` responde a `HEAD`, sem corpo. `OPTIONS` responde 204 com o header `Allow`.
- **405 e 404:** um método não suportado num path existente recebe 405 com `Allow`; um path inexistente recebe 404.
- **Herança:** uma subclasse herda as rotas, os middlewares e os guards do pai, usando o próprio prefixo, e pode sobrescrever handlers. A classe base não é alterada.
- **Dependências:** passe instâncias prontas; não há container nem mágica.

  ```ts
  const repo = new UserRepository(db);
  app.controllers([HealthController, new UserController(repo)]);
  ```

## Schemas: validação, serialização e tipos

`@Schema` aceita `params`, `query`, `headers`, `body` e `response`, escritos em [TypeBox](https://github.com/sinclairzx81/typebox) (JSON Schema).

```ts
const list = {
  query: Type.Object({
    limit: Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
    tag: Type.Optional(Type.Array(Type.String())),
  }),
  response: { 200: Type.Array(User) },
} satisfies RouteSchemas;

@Get('/')
@Schema(list)
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

O valor retornado pelo handler vira a resposta JSON. Para outros formatos:

| Método | Uso |
|---|---|
| `ctx.status(code)` | Define o status |
| `ctx.header(name, value)` | Define um header da resposta |
| `ctx.get(name)` | Lê um header da requisição |
| `ctx.json(data)` | JSON explícito |
| `ctx.text(str)` | `text/plain; charset=utf-8` |
| `ctx.send(body, contentType?)` | `string`, `Buffer`/`Uint8Array` ou `Readable` (stream) |
| `ctx.redirect(url, status?)` | 302 por padrão; aceita 301, 303, 307, 308 |
| `ctx.throw(status, message)` | Lança um `HttpError` |

Outros campos: `ctx.params`, `ctx.query`, `ctx.body`, `ctx.state`, `ctx.id`, `ctx.log`, `ctx.ip`, `ctx.method`, `ctx.path`, `ctx.url`, `ctx.req` e `ctx.res`.

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

Por controller ou por rota, use `@Use` e `@UseGuards`. Um guard retorna `true` para seguir, `false` para responder 403, ou lança um `HttpError` (por exemplo, `unauthorized()` para 401).

```ts
declare module 'picodecor' {
  interface ContextState { user?: { id: string; role: 'admin' | 'user' } }  // ctx.state tipado
}

const authenticate: Middleware = async (ctx, next) => {
  ctx.state.user = await verifyToken(ctx.get('authorization'));
  await next();
};
const isAdmin: Guard = (ctx) => ctx.state.user?.role === 'admin';

@Use(authenticate)
@Controller('/admin')
class AdminController {
  @UseGuards(isAdmin)
  @Delete('/users/:id')
  remove() {}
}
```

**Ordem de execução:**

```
middlewares globais → @Use (classe → método) → @UseGuards (classe → método) → validação → handler
```

Os guards rodam **antes** da validação: quem não tem acesso recebe 401/403, e não um 400 que revelaria o formato esperado. Vários `@Use` na mesma posição executam de cima para baixo.

## Erros

```ts
import { badRequest, forbidden, HttpError, internal, notFound, unauthorized } from 'picodecor';

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
| Headers de segurança | `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin`. HSTS é opt-in. |
| Limite de body | 1 MiB (`bodyLimit`). Recusado já pelo `Content-Length`, com a conexão fechada. |
| Timeouts | `requestTimeout` 30s, `headersTimeout` 10s, `keepAliveTimeout` 5s (contra Slowloris). |
| Query | Até 1000 pares (`queryMaxKeys`); `__proto__`, `constructor` e `prototype` são descartados. |
| Erros 5xx | Sem detalhes para o cliente. |
| Request id | Ids recebidos só são aceitos se forem seguros (contra log injection). |

Opt-in:

```ts
import { cors, createApp, rateLimit } from 'picodecor';

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
- **IP:** `ctx.ip` usa o IP do socket. Atrás de um proxy, `X-Forwarded-For` **não** é considerado.

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
const app = createApp().controllers([UserController]);

const server = await app.listen({ port: 3000, host: '0.0.0.0' }); // resolve quando está ouvindo

process.on('SIGTERM', async () => {
  await app.close(); // para de aceitar conexões e espera as requisições em andamento
  process.exit(0);
});

// Servidor próprio (HTTPS, http2 em modo compat…)
https.createServer(tlsOptions, app.callback()).listen(443);
```

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
| `securityHeaders` | ligado | Opções dos headers de segurança; `false` desliga |
| `timeouts` | 30s / 10s / 5s | `requestTimeout`, `headersTimeout`, `keepAliveTimeout` |
| `logger` | `consoleLogger()` | Logger compatível com pino; `false` desliga |
| `logRequests` | `false` | Log de cada requisição concluída |
| `requestId` | header `x-request-id` | `header`, `trustIncoming`, `generate` |

Métodos do app: `use()`, `controllers()`, `onError()`, `listen()`, `close()`, `callback()`, `inject()`, `log`.

O body só é lido como JSON quando o `Content-Type` é `application/json` ou `application/*+json`.

## Princípios

1. **Micro:** núcleo pequeno, com quatro dependências de runtime (`ajv`, `ajv-formats`, `fast-json-stringify`, `find-my-way`).
2. **Só decorators padrão (TC39):** sem `reflect-metadata`.
3. **Schema-first:** o schema é a fonte da validação, da serialização e dos tipos.
4. **Seguro por padrão:** desligar uma proteção é sempre explícito.
5. **Node nativo:** `node:http` direto.
6. **Explícito em vez de mágico:** controllers e dependências registrados à mão, sem varredura de arquivos.

**Extensões:** quando um recurso tem alternativas populares, o core traz uma implementação leve e um ponto de extensão; a biblioteca externa fica a critério do seu projeto. Estão planejados um parser de query plugável (para usar `qs`) e um validador plugável (Zod, Valibot e ArkType via Standard Schema).

**Fora do escopo:** ORM, views e SSR, CLI geradora, GraphQL e WebSockets no core, compatibilidade com middlewares do Express, Bun, Deno e edge (por enquanto).

## Exemplo completo

[`examples/app-users`](examples/app-users) traz CRUD, guards, CORS, rate limit, logger, herança e injeção de dependências, além de um script que percorre todos os cenários:

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

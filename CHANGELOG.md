# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e o projeto adota o [Versionamento Semântico](https://semver.org/lang/pt-BR/).
Enquanto estiver em `0.x`, mudanças incompatíveis podem ocorrer em versões _minor_.

## [Não lançado]

## [0.2.0] - 2026-11-06

### Adicionado
- Mapeamento manual depois do `mount`: `.get()`, `.post()`, `.put()`, `.patch()` e `.delete()`
  expõem um método da classe em outro path ou verbo, escolhido por um seletor checado pelo TypeScript
  (`(r) => r.getUser`). O path é relativo ao prefixo do grupo, e a rota aceita `{ middlewares, guards }`.
  Métodos sem decorator do Sashiko não podem ser expostos.
- `app.mount(x, { auto: false })` registra só as rotas manuais.
- `MountedGroup`, retornado por `app.mount()`: tem os verbos do mapeamento manual e os métodos do app
  (`mount`, `use`, `onError`, `listen`, `close`, `callback`, `inject`, `log`).

### Alterado
- **Incompatível:** `@Use` passou a se chamar `@Middlewares`, e `@UseGuards` passou a se chamar `@Guards`.
  Agora os nomes são os mesmos das opções `middlewares` e `guards`.
- **Incompatível:** `only` e `except` recebem um seletor em vez de nomes em texto:
  `only: (r) => [r.list, r.getUser]`.
- **Incompatível:** `app.mount()` retorna um `MountedGroup` em vez do app. Quem só encadeia
  `mount`/`use`/`listen` não precisa mudar nada.

## [0.1.0] - 2026-11-06

Primeira versão pública.

### Adicionado

**Rotas e composição**
- `@Router(prefix)` marca uma classe como grupo de rotas; `@Get`, `@Post`, `@Put`, `@Patch` e `@Delete`
  definem verbo e path.
- `app.mount(classeOuInstância, options)` é o ponto único de registro:
  - `prefix` monta a mesma classe sob outros prefixos;
  - `only` e `except` expõem parte dos métodos, com nomes checados pelo TypeScript;
  - `middlewares` e `guards` valem para todas as rotas do grupo.
- Dependências pelo construtor: `app.mount(new UserRoutes(repo))`, sem container de DI.
- Herança: uma subclasse herda as rotas, os middlewares e os guards da classe pai, sem alterá-la.
- `HEAD` automático para rotas `GET`; `OPTIONS` automático (204 com `Allow`); 405 com `Allow` para
  métodos não suportados.

**Schemas, validação e tipos**
- Schemas TypeBox (JSON Schema) para `params`, `query`, `headers`, `body` e `response`, no próprio verbo
  (`@Get('/:id', schemas)`) ou com `@Schema(schemas)`.
- Validação com Ajv:
  - coerção de tipos em params, query e headers, mas não no body;
  - defaults aplicados;
  - erros 400 com `details: [{ path, message }]` por campo.
- Resposta serializada pelo schema com `fast-json-stringify`, sem enviar campos não declarados.
  Com um único 2xx declarado, ele é o status padrão.
- `Context<S>` tipa `ctx.params`, `ctx.query` e `ctx.body` a partir dos schemas. Também são exportados
  os utilitários `InferSchema`, `InferParams`, `InferQuery`, `InferBody`, `InferHeaders` e `InferResponse`.
- `requireSchemas: true` exige schemas de body (POST/PUT/PATCH) e de resposta no registro.
- Query: chaves repetidas viram array, há limite de pares (`queryMaxKeys`) e chaves perigosas
  são descartadas.

**Contexto e respostas**
- `ctx.status()`, `ctx.header()`, `ctx.get()`, `ctx.json()`, `ctx.text()`, `ctx.send()` (string,
  Buffer ou stream), `ctx.redirect()` e `ctx.throw()`.
- `ctx.state`, extensível por declaration merging (`interface ContextState`), além de `ctx.id`,
  `ctx.log` e `ctx.ip`.

**Middlewares e guards**
- `app.use()`, `@Use()` e `@UseGuards()`, por classe ou por método.
- Ordem de execução: globais → `mount` → classe → método. Os guards rodam antes da validação.

**Erros**
- `HttpError` com `expose`, `cause` e `details`, e os helpers `notFound`, `badRequest`, `unauthorized`,
  `forbidden`, `internal` e `isHttpError`.
- `app.onError()` para integrar com APMs. Uma falha dentro dele não derruba o processo.

**Segurança**
- Ligado por padrão:
  - headers `nosniff`, CSP restritiva, `Referrer-Policy`, `X-Frame-Options` e
    `Cross-Origin-Resource-Policy`, configuráveis em `securityHeaders` (HSTS é opt-in);
  - limite de body, recusado já pelo `Content-Length`, com a conexão fechada;
  - timeouts do servidor;
  - erros 5xx sem detalhes internos para o cliente.
- Middleware `cors()`: origem obrigatória (string, lista, RegExp ou função), preflight 204 e
  `Vary: Origin`. Combinar `'*'` com `credentials` é recusado.
- Middleware `rateLimit()`: responde 429 com `Retry-After` e aceita outro store (`RateLimitStore`).

**Logs**
- Logger compatível com pino (`logger`, `consoleLogger()`, `logger: false`), `app.log` e
  `logRequests`.
- Request id em `ctx.id` e no header `X-Request-Id`. Um id recebido só é reaproveitado se for
  seguro, contra log injection.

**Ciclo de vida e testes**
- `await app.listen({ port, host })` e `app.close()` com encerramento gracioso.
- `app.callback()` para servidores próprios (HTTPS, http2 em modo compat).
- `app.inject()` executa requisições em memória, sem rede.

**Ferramentas**
- Mensagens de erro claras quando os decorators são usados com `experimentalDecorators` ou sem
  `Symbol.metadata`.
- Exemplo completo em `examples/app-users`, com o script `scenarios.sh`.

### Requisitos
- Node.js 22 ou superior.
- TypeScript 5.2 ou superior, com decorators padrão (TC39), sem `experimentalDecorators`.

[Não lançado]: https://github.com/code-cfernandes/sashiko/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/code-cfernandes/sashiko/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/code-cfernandes/sashiko/releases/tag/v0.1.0

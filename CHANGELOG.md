# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e o projeto adota o [Versionamento Semântico](https://semver.org/lang/pt-BR/).
Enquanto estiver em `0.x`, a versão _minor_ sobe com funcionalidades novas ou mudanças incompatíveis,
e a _patch_ só com correções.

## [Não lançado]

### Adicionado
- Guards de autenticação `bearerAuth({ verify })` e `basicAuth({ verify })`. O usuário vai para `ctx.state.user`,
  e qualquer falha recebe o mesmo 401 com `WWW-Authenticate`, sem revelar o motivo. `safeEqual()` compara
  segredos em tempo constante.
- `consoleLogger({ redact })` mascara chaves sensíveis em qualquer nível. Por padrão: `authorization`,
  `cookie`, `password`, `token` e afins; `DEFAULT_REDACT_KEYS` e `redactValue()` são exportados.
- `SECURITY.md`, com como reportar vulnerabilidades e a política de dependências, e Dependabot semanal para
  npm e GitHub Actions.

### Alterado
- **Incompatível:** um body JSON com `__proto__` ou `constructor.prototype`, em qualquer nível, recebe 400
  (`PROTO_POISONING`). **Migração:** se esses bodies precisarem passar, use `createApp({ protoPoisoning:
  'remove' })`, que descarta as chaves.
- **Incompatível:** o `consoleLogger` padrão passa a mascarar chaves sensíveis nos dados logados. **Migração:**
  `consoleLogger({ redact: false })` volta ao comportamento anterior.

## [0.9.0] - 2026-11-06

### Adicionado
- HTTPS no `app.listen({ tls: { key, cert } })` (ou `pfx` + `passphrase`), com os mesmos timeouts, o mesmo
  encerramento gracioso, o `close()` e o `onClose` do HTTP. TLS 1.2 é o mínimo (`minVersion: 'TLSv1.3'` é
  opcional), e um certificado inválido falha no `listen()`.
- SNI: `tls.sni` com um certificado por domínio e curinga de um nível (`'*.exemplo.dev'`).
- `app.reloadTLS()` troca os certificados sem reiniciar, para renovação ou ACME externo. Um certificado
  inválido mantém os atuais.
- Tipos `TlsOptions` e `TlsCertificate`. O `listen()` com `tls` é tipado como `https.Server`.

## [0.8.0] - 2026-11-06

### Adicionado
- `app.group({ prefix, middlewares, guards }, (g) => g.mount(A).mount(B))`: prefixo, middlewares e guards
  comuns a vários `mount()`. Os prefixos se somam (e podem ter parâmetros), e a ordem é grupo → `mount()` →
  classe → método. Grupos podem ser aninhados, e o encadeamento (`.mount()`, `.get()`) continua no grupo.
  Também disponível a partir do retorno de `mount()`. Tipos `GroupOptions` e `RouteGroupScope`.

## [0.7.0] - 2026-11-06

### Alterado
- **Incompatível:** todos os erros (`HttpError`, validação, JSON inválido, body grande demais, 404, 405, 406,
  `Host` inválido, guards, CSRF e rate limit) saem no formato Problem Details (RFC 9457), com
  `Content-Type: application/problem+json`: `{ type, title, status, detail?, code?, details? }`. A mensagem
  passa de `error` para `detail`, e o `code` do `HttpError` agora chega ao cliente. No 405, `allowed` passa
  para `details.allowed`. **Migração:** leia `detail` (ou `title`) no lugar de `error`, ou mantenha o formato
  antigo com `createApp({ formatError: (p) => ({ error: p.detail ?? p.title, details: p.details }) })`.

### Adicionado
- `AppOptions.formatError`, para personalizar o corpo de todos os erros.
- Opção `type` no `HttpError` (URI do tipo do problema) e os tipos `ProblemDetails` e `ErrorFormatter`.
- Códigos `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `METHOD_NOT_ALLOWED` e `INVALID_HOST` nos erros do framework.
- Path e `params` conferidos. Em compilação, um parâmetro do path ausente no schema de `params` do verbo é
  erro de tipo. No `app.mount()`, path x schema são conferidos nos dois sentidos, com o prefixo, e paths
  malformados (`/:`, nome repetido, regex aberta, `*` no meio) falham com a rota na mensagem.
- `Context<'/:org/users/:id'>` tipa `ctx.params` pelo path; tipos `PathParams`, `ParamsOf` e `CheckParams`.
- OpenAPI 3.1: `app.openapi({ info, servers, path, docs, middlewares, guards })` serve `/openapi.json`,
  gerado das rotas e dos schemas (parâmetros, body, respostas por status e content type, erros como
  `ProblemDetails`). Com `docs: true`, serve também o Swagger UI em `/docs` (versão fixada, SRI e CSP com
  nonce). `middlewares` e `guards` protegem só essas rotas. `app.openapiDocument()` devolve o documento,
  sem expor rota nenhuma.

## [0.6.0] - 2026-11-06

### Adicionado
- Cookies: `ctx.cookies`, `ctx.setCookie()` e `ctx.clearCookie()`, com `HttpOnly`, `Secure`, `SameSite=Lax` e
  `Path=/` por padrão. Nome, `path` e `domain` inválidos lançam erro (sem injeção de atributos), e as
  regras de `SameSite=None`, `Partitioned` e dos prefixos `__Host-`/`__Secure-` são conferidas.
- Middleware `csrf()`: recusa com 403 os métodos que alteram estado vindos de outra origem, com base no
  `Sec-Fetch-Site` e no `Origin`. `trustedOrigins` usa as mesmas regras do `cors()`. Com `token: true`,
  adiciona o double-submit token (cookie `__Host-csrf` e header `X-CSRF-Token`, exposto em
  `ctx.state.csrfToken`).

## [0.5.0] - 2026-11-06

### Adicionado
- `Type`, `Static` e `TSchema` do TypeBox re-exportados por `sashiko`, e `@sinclair/typebox` passou a ser
  dependência de runtime. Não é mais preciso instalá-lo à parte: `import { Type } from 'sashiko'`.
- Curinga de subdomínio nas regras de origem e de host: `cors({ origin: 'https://*.exemplo.dev' })` e
  `allowedHosts: ['*.exemplo.dev']`. Aceita só subdomínios, nunca o domínio em si nem
  `exemplo.dev.atacante.com`.

### Alterado
- **Incompatível:** nas regras de `cors({ origin })` e `allowedHosts`, uma RegExp precisa casar a string
  **inteira**, como se tivesse `^…$`. Uma regex de sufixo como `/\.exemplo\.dev$/` deixa de aceitar
  `https://preview.exemplo.dev`. **Migração:** use o curinga (`'https://*.exemplo.dev'`) ou uma regex
  completa (`/^https:\/\/[a-z0-9-]+\.exemplo\.dev$/`).
- **Incompatível:** regras inválidas falham na criação do app ou do middleware: origem sem esquema
  (`'app.exemplo.com'`), `'*'` dentro de uma lista, curinga fora da primeira posição. Antes, uma origem
  sem esquema simplesmente nunca casava.
- Strings de origem são comparadas depois de normalizar com o parser de URL (maiúsculas, porta padrão,
  barra final, IDN). `'https://App.exemplo.com:443/'` casa com `https://app.exemplo.com`.

### Segurança
- RegExp com as flags `g` ou `y` em `cors()` e `allowedHosts` alternava entre aceitar e recusar a mesma
  origem em requisições seguidas, por causa do `lastIndex`. Agora essas flags (e a `m`) são descartadas,
  sem ampliar o que é aceito.
- RegExp sem âncora em `cors()` e `allowedHosts` aceitava origens e hosts que apenas *continham* o padrão
  (`app.exemplo.com.atacante.com`). Agora a string inteira precisa casar.

## [0.4.0] - 2026-11-06

### Adicionado
- Hooks de ciclo de vida:
  - `app.onSend()`: síncrono, antes de escrever respostas com corpo, inclusive erros e 404. Pode alterar
    headers ou o payload; se lançar, a resposta original é enviada.
  - `app.onResponse()`: depois do envio, com status e duração.
  - `app.onClose()`: em qualquer `close()`, antes do `shutdown.onShutdown`.
- `ctx.sentBody` e `ctx.sentType`: o corpo exatamente como foi enviado, depois do `await next()` num
  middleware. Permite cache com gravação, sempre com os campos já filtrados pelo schema.
- Exemplo: cache em memória em `/public/users` (`X-Cache: MISS/HIT`) e `onClose`.

### Corrigido
- Respostas JSON escreviam fora do ponto único de escrita do pipeline.

## [0.3.1] - 2026-11-06

### Adicionado
- `ctx.host`, `ctx.hostname` e `ctx.protocol`, com o host validado.
- `createApp({ trustProxy })`: `true` ou o número de proxies à frente do app. Com isso, `ctx.ip`, `ctx.host`
  e `ctx.protocol` usam os headers `X-Forwarded-*`.
- `createApp({ allowedHosts })`: lista de hosts aceitos (string ou RegExp); os demais recebem 400.

### Segurança
- Um `Host` malformado respondia 500; agora responde 400 antes de qualquer middleware.
- O path vinha do parsing da URL com o `Host` do cliente, e um request-target como `//evil.com/x` virava
  o path `/x` com host `evil.com`. Isso permitia contornar regras de proxy baseadas em path. Agora o path é
  o recebido (`//evil.com/x`), e o `ctx.url` usa só o host validado.

## [0.3.0] - 2026-11-06

### Adicionado
- Encerramento gracioso embutido: o `listen()` trata SIGINT e SIGTERM, espera as requisições em
  andamento (com prazo) e sai com código 0. Configurável em `createApp({ shutdown })` (`signals`,
  `timeoutMs`, `onShutdown`, `exit`); `shutdown: false` desliga. Um segundo sinal força a saída.
- Respostas além do JSON:
  - o tipo da resposta vem do valor retornado em rotas sem schema (string → `text/plain`,
    Buffer → `application/octet-stream`, stream);
  - `contentType` nas entradas de `response`, com um tipo ou uma lista negociada pelo `Accept`
    (q-values, curingas, `406 Not Acceptable` e `Vary: Accept`);
  - serializadores plugáveis em `createApp({ serializers })`;
  - campos não declarados são removidos em qualquer formato.
- Preset `securityHeaders: 'web'`, para quem também serve páginas.
- `ctx.status(code)` tipado: com schemas de resposta, aceita só os status declarados, e o `json()`/`send()`
  seguinte exige o corpo daquele status (`StatusContext`, `DeclaredStatus` e `BodyFor` exportados).
- `ctx.send(objeto)` envia objetos pelo pipeline, com negociação pelo `Accept`.

### Alterado
- **Incompatível:** numa rota **sem** schema de resposta, retornar uma string agora responde
  `text/plain` com o texto cru, em vez de uma string JSON. Rotas com schema JSON não mudam.

### Segurança
- `ctx.json()`, `ctx.send()` e `ctx.text()` no handler passam pelo mesmo pipeline do `return`: schema do
  status, remoção de campos não declarados e status padrão. Antes, o envio imperativo ignorava o schema
  de resposta e podia vazar campos como `password`.

### Corrigido
- O `close()` não fica mais preso esperando conexões keep-alive que ficam ociosas depois de
  responder durante o encerramento.

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

[Não lançado]: https://github.com/code-cfernandes/sashiko/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/code-cfernandes/sashiko/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/code-cfernandes/sashiko/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/code-cfernandes/sashiko/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/code-cfernandes/sashiko/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/code-cfernandes/sashiko/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/code-cfernandes/sashiko/releases/tag/v0.1.0

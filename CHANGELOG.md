# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e o projeto adota o [Versionamento Semântico](https://semver.org/lang/pt-BR/).
Enquanto estiver em `0.x`, a versão _minor_ sobe com funcionalidades novas ou mudanças incompatíveis,
e a _patch_ só com correções.

## [Não lançado]

## [0.13.0] - 2026-11-07

### Alterado

- **Incompatível: middlewares globais seguem o modelo onion do Koa, como o README já documentava.** O código depois
  do `await next()` num `app.use()` agora roda **depois** do roteamento e do handler (antes, rodava antes da
  rota). Medir o tempo da requisição, ler `ctx.sentBody` ou pós-processar a resposta passa a funcionar como
  documentado. **Migração:** um middleware global que, depois do `next()`, alterava headers ou o estado esperando
  que isso valesse para a rota deve fazer essa alteração **antes** do `next()`.
- **Incompatível: um middleware global que não chama `next()` nem responde interrompe a requisição.** Antes, a
  rota rodava mesmo assim: um middleware de autenticação que esquecesse o `throw` liberava o acesso. Agora o
  handler não roda, o app responde 404 e registra um aviso. **Migração:** para bloquear, lance um erro
  (`throw unauthorized()`) ou responda; para seguir, chame `next()`.
- **Incompatível: o host validado é o host roteado.** Um middleware que reescreve `req.headers.host` não muda mais
  o roteamento por virtual host. Antes, isso permitia contornar o `allowedHosts`, que é conferido antes dos
  middlewares. **Migração:** para mapear hosts, use regras de `host` no `mount()`/`group()` ou `trustProxy` com o
  `X-Forwarded-Host` do proxy.
- Um cliente que desconecta no meio de um arquivo ou stream é registrado em nível `debug` (`client disconnected
  during stream`), e não mais como erro `stream failed`. Falhas da fonte (leitura do disco) continuam em `error`.

### Desempenho

- Refatoração interna guiada por benchmark e profiling (sem mudança de API pública):
  - `app.ts` dividido em registro, rotas do framework, servidor e pipeline da requisição;
  - `ctx.url`, `ctx.query` e `ctx.log` criados no primeiro acesso, e `host`/`protocol` memoizados;
  - logger padrão com a configuração compartilhada entre os filhos;
  - programa de cada rota e cadeias de middlewares montados no registro;
  - callback da requisição sem closures, `Content-Type` escrito uma vez e `ctx.sentBody` convertido só se lido.
    Os números, a metodologia e a atribuição de cada ganho estão no PR e em `docs/ARCHITECTURE.md`.

## [0.12.2] - 2026-11-06

### Corrigido

- `ctx.sse()` aberto depois de uma desconexão já ocorrida (num `await` anterior) ficava aberto: o heartbeat
  continuava e o `onClose` nunca era chamado. Agora o stream fecha na hora.
- `inject()` de uma resposta bem-sucedida cancelava o `ctx.signal`. A troca para `writableEnded` anunciada na
  0.12.1 não tinha entrado no código; agora entrou, nos dois pontos da detecção de desconexão.
- `heartbeatMs` e `retry` acima de 2147483647 ms eram aceitos, e o Node os reduzia para 1 ms (heartbeat
  contínuo). Agora são recusados.
- `data` do SSE que não vira JSON (`Symbol`, função, `BigInt`, objeto circular) gerava um erro interno ou cru.
  Agora gera uma mensagem clara, sem escrever um evento parcial.
- Um segundo `ctx.sendFile()` depois de a resposta ter saído ainda alterava os headers. Agora é ignorado, como
  `ctx.json()` e `ctx.send()`.

## [0.12.1] - 2026-11-06

### Corrigido

- `ctx.signal` não era cancelado se o cliente desconectasse antes do primeiro acesso a ele (por exemplo,
  durante um `await` anterior), porque o evento de fechamento já tinha passado. Agora nasce cancelado.
- `If-Range` seguia regras mais frouxas que a RFC 9110. Um ETag (os nossos são fracos) autorizava resposta
  parcial, e uma data posterior ao `Last-Modified` também. Agora só uma data exatamente igual autoriza o `Range`.
- `Range` era processado em `HEAD`, que respondia 206, e uma unidade desconhecida (`items=0-1`) ou uma
  sintaxe inválida recebia 416. Agora o `Range` só vale para `GET`, e o resto é ignorado (200 com o arquivo
  inteiro).
- `ctx.sse()`: `heartbeatMs` e `retry` negativos ou fracionários são recusados (um heartbeat negativo virava
  envio contínuo). Um `id` com U+0000, que o navegador ignoraria, é recusado. `data` ausente gera um erro
  claro, em vez de uma falha interna.
- `static()` não existia no retorno de `mount()`: `app.mount(X).static(...)` falhava em JavaScript (em
  TypeScript, nem compilava). Agora existe e respeita o escopo do grupo.
- `static()` não funcionava com `requireSchemas: true`, que exigia schema de resposta das rotas de arquivo. As
  rotas internas agora ficam fora dessa exigência.
- `ctx.sendFile()` sem `await`/`return` no handler respondia 200 vazio, e um erro (404, por exemplo) virava um
  `unhandledRejection`, que derruba o processo no Node. Agora o app aguarda o envio pendente, e o erro passa
  pelo tratamento normal.
- `inject()` não emitia `finish`/`close`. Com isso, `onResponse` e `logRequests` não rodavam em testes, e cada
  `inject()` ficava para sempre entre as respostas em andamento do app (vazamento de memória em suítes longas).

## [0.12.0] - 2026-11-06

### Adicionado

- Arquivos estáticos: `app.static(prefix, root, opts)` e `g.static()` dentro de `group()`, como rotas `GET`/`HEAD`.
  - Proteção contra path traversal: `..` codificado, symlinks para fora da raiz, barra invertida e byte nulo.
  - Arquivos ocultos negados por padrão e diretórios nunca listados (com `index` opcional).
  - `ETag`/`Last-Modified` com 304, `Range` com 206/416 e `If-Range`, `Cache-Control` (`maxAge`, `immutable`).
  - Tabela de tipos sem dependência e `fallback` para SPA. Ficam fora do OpenAPI.
- `ctx.sendFile(path, { root, download, ... })`, com `Content-Disposition` em UTF-8.
- `ctx.sse()`: Server-Sent Events, com heartbeat, `retry`, `Last-Event-ID`, `onClose`, eventos multilinha e
  recusa de quebra de linha em `event`/`id`.
- Async iterables como retorno do handler viram NDJSON (`application/x-ndjson`), com schema por item.
- `ctx.signal`: um `AbortSignal` cancelado quando o cliente desconecta. No shutdown, os streams já iniciados
  (SSE, NDJSON) são cancelados e fecham na hora, sem segurar o encerramento até o prazo.
- Tipos `StaticOptions`, `SendFileOptions`, `FileOptions`, `SseStream`, `SseEvent` e `SseOptions`.

## [0.11.4] - 2026-11-06

### Corrigido

- `health()` ou `openapi()` chamados dentro do callback de um `group()` não enxergavam as rotas ainda pendentes do
  grupo e podiam encobri-las. Se o grupo falhasse, a configuração ficava aplicada mesmo assim. Agora as duas
  chamadas são recusadas enquanto um `group()` está em andamento, porque configuram o app e não o grupo.

## [0.11.3] - 2026-11-06

### Corrigido

- Atomicidade de cada `mount()` dentro de um `group()`: quando um `mount()` falhava no meio (por exemplo, um
  conflito na segunda rota) e o callback capturava o erro, as rotas anteriores desse `mount()` eram efetivadas
  com o grupo. Agora cada `mount()` e cada rota manual restauram o lote ao estado anterior quando falham.
- `health()` e `openapi()` encobriam, sem aviso, uma rota GET do usuário com o mesmo path. Agora o conflito gera
  erro no registro, em qualquer ordem, e também entre os dois.
- Healthchecks com `allowedHosts`: sondas do Kubernetes e do ECS, que mandam o IP do pod no `Host`, recebiam 400
  e tiravam a instância de rotação. Agora o `/livez` e o `/readyz` aceitam qualquer host válido (um `Host`
  malformado continua 400). `health({ anyHost: false })` mantém o comportamento estrito.
- `/readyz/`, `/livez/`, `/openapi.json/` e `/docs/` (com barra final) respondiam 404, ao contrário das rotas
  normais.
- `reloadTLS()` com `sni` não tinha efeito quando o `listen({ tls })` original não tinha `sni`.

### Observação

- Um `Set-Cookie` (ou outro header) definido pelo handler antes de lançar um erro continua na resposta de erro,
  como no Express e no Fastify. Se o handler cria uma sessão, crie-a só depois das operações que podem falhar.

## [0.11.2] - 2026-11-06

### Corrigido

- `group()` assíncrono: um `g.mount()` chamado depois de um `await` registrava a rota fora da transação do
  grupo. Agora o escopo do grupo é invalidado quando o callback termina, e qualquer `mount()`, `get()` ou
  `group()` posterior gera erro, inclusive nos `MountedGroup` criados dentro dele. A Promise do callback
  recebe um handler, então não há `unhandledRejection`, e o erro vai para o log.
- Grupo aninhado que falha com o erro capturado pelo grupo externo: as rotas do aninhado eram efetivadas
  junto com as do externo. Agora só a parte do aninhado é descartada.
- OpenAPI por host: `/users` e `/users/` são tratados como o mesmo path na seleção da rota documentada, como no
  roteador. Antes, a rota documentada podia ser outra. A conferência de duplicidade dentro de um `group()`
  também usa a forma canônica.

## [0.11.1] - 2026-11-06

### Corrigido

- OpenAPI por host documentava, em alguns casos, uma rota diferente da executada. Quando uma rota global e uma
  com host tinham o mesmo método e path, o documento podia mostrar a global, conforme a ordem de registro.
  Agora o documento usa a mesma seleção do roteador.
- Prioridade entre curingas sobrepostos: `*.api.exemplo.com` vence `*.exemplo.com` independentemente da ordem
  de registro, por uma estratégia de host própria no roteador. A ordem é exato → curinga mais específico →
  RegExp (na ordem de registro) → sem host.
- Registro atômico: um conflito no `mount()`, numa lista de hosts ou num `group()` não deixa rotas parciais
  registradas. A validação vem antes do registro, e um conflito tardio desfaz o que já tinha entrado.
- `group()` com callback assíncrono, que devolve um thenable, ou que lança erro não deixa rotas registradas.
- `unreachableHosts` deixou de recusar configurações válidas: um curinga com um host permitido dentro dele, e um
  host exato com `allowedHosts` com porta. Quando não dá para provar a interseção (RegExp), só avisa no log, uma
  vez por `mount` e host.
- A conferência de rota duplicada considera `/x` e `/x/` como a mesma rota, como o roteador.

## [0.11.0] - 2026-11-06

### Adicionado

- Virtual hosts: `mount(X, { host })` e `group({ host }, …)`, com string exata, `*.dominio` (qualquer profundidade)
  ou RegExp de casamento inteiro, ou uma lista. A prioridade é host exato → curinga/RegExp → rota sem host. O
  roteamento usa o `ctx.hostname` validado (com `trustProxy`), e o 404 e o 405 são calculados por host.
- `AppOptions.unreachableHosts` (`'error'` por padrão, `'warn'` ou `'off'`): uma rota com `host` fora do
  `allowedHosts` falha no registro.
- OpenAPI por host: o `/openapi.json` documenta as rotas do host da requisição mais as sem host, e
  `openapiDocument({ host })` gera o documento de um host. Tipo `HostOption`.

### Alterado

- `openapiDocument()` sem `host` traz só as rotas sem restrição de host. Apps sem virtual hosts não mudam.

## [0.10.0] - 2026-11-06

### Adicionado

- Guards de autenticação `bearerAuth({ verify })` e `basicAuth({ verify })`. O usuário vai para `ctx.state.user`,
  e qualquer falha recebe o mesmo 401 com `WWW-Authenticate`, sem revelar o motivo. `safeEqual()` compara
  segredos em tempo constante.
- `consoleLogger({ redact })` mascara chaves sensíveis em qualquer nível. Por padrão: `authorization`,
  `cookie`, `password`, `token` e afins; `DEFAULT_REDACT_KEYS` e `redactValue()` são exportados.
- `app.health({ checks, timeoutMs, live, ready, guards, middlewares })`: `/livez` e `/readyz`. Os checks rodam em
  paralelo, com timeout. O `/readyz` responde 503 se algum check falhar e durante o encerramento, sem expor o
  motivo, que vai para o log. As rotas são servidas antes dos middlewares globais.
- `shutdown.drainDelayMs`: espera com o `/readyz` em 503 antes de fechar o servidor, para o load balancer tirar
  a instância de rotação.
- `consoleLogger({ format: 'json' })`: uma linha JSON por evento (`level`, `time`, `msg`), com erros
  serializados e ciclos tratados.
- README: seção "Deploy em produção", com exemplo e checklist.
- Desenvolvimento: lint e formatação com Biome (`pnpm lint`, `pnpm format`, `pnpm check`), um job de lint no CI
  e `pnpm check` no `prepublishOnly`. Não muda nada no pacote publicado.
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
- RegExp sem âncora em `cors()` e `allowedHosts` aceitava origens e hosts que apenas _continham_ o padrão
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

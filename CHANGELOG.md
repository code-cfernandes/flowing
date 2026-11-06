# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e o projeto adota o [Versionamento Semântico](https://semver.org/lang/pt-BR/).
Enquanto estiver em `0.x`, mudanças incompatíveis podem ocorrer em versões _minor_.

Cada entrada cita a spec correspondente em [`SPECS/`](SPECS/README.md) quando houver.

## [Não lançado]

### Adicionado
- Estrutura do framework: `src/core` (runtime), `src/decorators`, `src/schema` (validação e serialização),
  `src/shims` e ponto de entrada público `src/index.ts`.
- Exemplo de CRUD em `examples/users`, importando o framework pelo alias `picodecor`.
- Exemplo `examples/app-users` com CRUD completo, CORS, rate limit, headers de segurança, `requireSchemas`,
  herança de controllers e o script `scenarios.sh`, que percorre todos os cenários.
- `tsconfig.build.json` para gerar a biblioteca em `dist/`; `package.json` com `exports`, `types` e `files`.
- Pasta `SPECS/` com uma spec por bug, risco de segurança, funcionalidade e risco de projeto.
- Suíte de testes com `node:test` + `tsx` (`pnpm test`, `pnpm test:watch`). (F-19)
- `HttpError` ganhou as opções `expose`, `cause` e `details`; novo helper `isHttpError()`. (S-05)
- Respostas 400 de validação agora trazem `details: [{ path, message }]` com cada campo inválido. (B-02)
- Validação do schema `headers` declarado em `@Schema`. (B-03)
- Middleware `cors(options)` com lista, RegExp ou função de origem, preflight 204 e `Vary: Origin`;
  `origin: '*'` com `credentials` é rejeitado. (S-01)
- Headers de segurança ligados por padrão (`nosniff`, CSP, `Referrer-Policy`, `X-Frame-Options`,
  `Cross-Origin-Resource-Policy`; HSTS opt-in), configuráveis por `AppOptions.securityHeaders`. (S-02, S-04)
- Middleware `rateLimit()` com `MemoryRateLimitStore` e interface de store plugável; responde 429. (S-06)
- `AppOptions.timeouts` (`requestTimeout`, `headersTimeout`, `keepAliveTimeout`) com defaults seguros. (S-06)
- `AppOptions.requireSchemas` para exigir schemas de body e de resposta no registro das rotas. (S-07)
- `HEAD` automático para rotas `GET` e `OPTIONS` automático (204 + `Allow`). (F-08)
- `ctx.ip`.
- `AppOptions.queryMaxKeys` limita os pares lidos da query string (padrão 1000). (S-06)
- `app.controllers()` aceita instâncias, para injetar dependências pelo construtor. (B-10)
- Script `pnpm test:coverage` com limites mínimos de cobertura. (F-19)
- O exemplo `app-users` passa a injetar um `UserRepository` nos controllers. (F-18)
- Opção `--test-timeout` nos scripts de teste, para um request travado não segurar a suíte.

### Alterado
- `Symbol.metadata` agora vem do shim `src/shims/symbol-metadata.ts` (antigo `core/polyfill.ts`).
- A metadata de controllers foi movida para `src/core/metadata.ts`, para que o core não dependa de `decorators/`.
- **Incompatível:** o decorator `cors` foi removido em favor do middleware `cors()`. (B-04)
- **Incompatível:** `timer` virou uma fábrica: use `@timer()` em vez de `@timer`. (B-04)
- O header `Allow` em respostas 405 passa a incluir `HEAD` e `OPTIONS`.
- `src/core/app.ts` foi dividido por responsabilidade: `body-parser.ts`, `request-validation.ts` e
  `response.ts`. Funções puras e genéricas foram para `src/utils/` (`query.ts`, `content-type.ts`,
  `path.ts`), que é interno e não é exportado pela API pública.
- `.gitignore` revisado (build, logs, `.env`, coverage, editores).

### Corrigido
- Exceção dentro de um `onError` não derruba mais o processo: o erro é logado e a resposta
  padrão é enviada com o erro original. `listen()` também captura qualquer falha restante. (B-08)
- Subclasses de controllers não alteram mais a metadata da classe pai: herdam as rotas
  e usam o próprio prefixo. Classes sem `@Controller` próprio são rejeitadas. (B-09)
- O body não sofre mais coerção de tipos (`"30"` não vira `30`); params, query e headers
  continuam com coerção. A validação não remove mais campos do objeto em silêncio. (B-06)
- Com um único 2xx declarado no schema, ele vira o status padrão sem `ctx.status()`. Um status sem
  schema correspondente responde 500 em vez de enviar o objeto sem filtro. (B-05)
- Query com chaves repetidas vira array, e um valor único é aceito por schemas de array. (B-07)
- O body só é tratado como JSON para `application/json` e `application/*+json`, comparando o media type
  em vez de procurar uma substring. (B-11)
- `timer` mede corretamente handlers `async` e também quando o handler lança. (B-04)
- Corpo acima do `bodyLimit` é rejeitado antes da leitura pelo `Content-Length`, e a conexão é
  fechada. (B-12)
- `ctx.throw()` agora lança `HttpError`: JSON malformado responde 400 e payload acima do limite
  responde 413, em vez de 500. (B-01)

### Segurança
- Erros 5xx e erros desconhecidos não expõem mais a mensagem original ao cliente; a resposta é
  `Internal Server Error` e o erro completo é logado no servidor. (S-05)
- Chaves `__proto__`, `constructor` e `prototype` são descartadas da query. (S-08, parcial)

## [0.0.1] - 2026-11-05

### Adicionado
- Versão inicial: decorators `@Controller`, `@Get`/`@Post`/`@Put`/`@Patch`/`@Delete` e `@Schema`,
  roteamento com `find-my-way`, validação com Ajv e serialização com `fast-json-stringify`.

[Não lançado]: https://github.com/OWNER/picodecor/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/OWNER/picodecor/releases/tag/v0.0.1

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
- `tsconfig.build.json` para gerar a biblioteca em `dist/`; `package.json` com `exports`, `types` e `files`.
- Pasta `SPECS/` com uma spec por bug, risco de segurança, funcionalidade e risco de projeto.
- Suíte de testes com `node:test` + `tsx` (`pnpm test`, `pnpm test:watch`). (F-19)
- `HttpError` ganhou as opções `expose`, `cause` e `details`; novo helper `isHttpError()`. (S-05)
- Respostas 400 de validação agora trazem `details: [{ path, message }]` com cada campo inválido. (B-02)
- Validação do schema `headers` declarado em `@Schema`. (B-03)
- Opção `--test-timeout` nos scripts de teste, para um request travado não segurar a suíte.

### Alterado
- `Symbol.metadata` agora vem do shim `src/shims/symbol-metadata.ts` (antigo `core/polyfill.ts`).
- A metadata de controllers foi movida para `src/core/metadata.ts`, para que o core não dependa de `decorators/`.
- Os decorators `cors` e `timer` passaram a ser exportados.
- `.gitignore` revisado (build, logs, `.env`, coverage, editores).

### Corrigido
- Exceção dentro de um `onError` não derruba mais o processo: o erro é logado e a resposta
  padrão é enviada com o erro original. `listen()` também captura qualquer falha restante. (B-08)
- Subclasses de controllers não alteram mais a metadata da classe pai: herdam as rotas
  e usam o próprio prefixo. Classes sem `@Controller` próprio são rejeitadas. (B-09)
- O body não sofre mais coerção de tipos (`"30"` não vira `30`); params, query e headers
  continuam com coerção. A validação não remove mais campos do objeto em silêncio. (B-06)
- `ctx.throw()` agora lança `HttpError`: JSON malformado responde 400 e payload acima do limite
  responde 413, em vez de 500. (B-01)

### Segurança
- Erros 5xx e erros desconhecidos não expõem mais a mensagem original ao cliente; a resposta é
  `Internal Server Error` e o erro completo é logado no servidor. (S-05)

## [0.0.1] - 2026-11-05

### Adicionado
- Versão inicial: decorators `@Controller`, `@Get`/`@Post`/`@Put`/`@Patch`/`@Delete` e `@Schema`,
  roteamento com `find-my-way`, validação com Ajv e serialização com `fast-json-stringify`.

[Não lançado]: https://github.com/OWNER/picodecor/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/OWNER/picodecor/releases/tag/v0.0.1

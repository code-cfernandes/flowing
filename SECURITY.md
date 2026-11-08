# Segurança

## Como reportar uma vulnerabilidade

**Não abra uma issue pública.** Use o [reporte privado de vulnerabilidades do GitHub](https://github.com/code-cfernandes/flowing/security/advisories/new). Inclua a versão afetada, um exemplo mínimo e o impacto esperado. A resposta inicial sai em até 7 dias.

## Versões com correções de segurança

Enquanto o projeto estiver em `0.x`, só a **última minor** recebe correções. Versões antigas com falhas conhecidas são marcadas como descontinuadas (`npm deprecate`).

## Cadeia de suprimentos

- **Poucas dependências de runtime:** sete. Uma dependência nova exige justificativa no PR.
  - `@sinclair/typebox`, `ajv`, `ajv-formats` e `fast-json-stringify`: os contratos das rotas (schemas, validação e serialização).
  - `find-my-way`: o roteador.
  - `@fastify/busboy`: a leitura de upload (`multipart/form-data`). O formato é complexo e sensível (limites, cabeçalhos, nomes de arquivo) e não é reimplementado; é o fork mantido pelo time do Fastify, sem dependências.
  - `magic-bytes.js`: a conferência do conteúdo dos arquivos enviados pelos primeiros bytes (um executável com nome `.pdf` é recusado). Sem dependências. Para conferências mais completas, como abrir um `.docx`, o `file-type` pode ser ligado pela aplicação, sem virar dependência do Flowing.
- **Versões travadas** pelo `pnpm-lock.yaml`, com instalação `--frozen-lockfile` no CI.
- **`pnpm audit --prod --audit-level=high`** em todo PR: uma vulnerabilidade alta ou crítica nas dependências de produção bloqueia o merge.
- **Dependabot** semanal para npm e GitHub Actions:
  - **runtime:** um PR por atualização, lendo o changelog da dependência antes do merge;
  - **desenvolvimento:** minor e patch agrupadas num PR só;
  - **major:** sempre num PR próprio, com os testes passando nas versões de Node suportadas.
- **Pacote publicado** só com `dist/`, `README`, `LICENSE` e `package.json`, conferido no CI.

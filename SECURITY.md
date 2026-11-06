# Segurança

## Como reportar uma vulnerabilidade

**Não abra uma issue pública.** Use o [reporte privado de vulnerabilidades do GitHub](https://github.com/code-cfernandes/sashiko/security/advisories/new). Inclua a versão afetada, um exemplo mínimo e o impacto esperado. A resposta inicial sai em até 7 dias.

## Versões com correções de segurança

Enquanto o projeto estiver em `0.x`, só a **última minor** recebe correções. Versões antigas com falhas conhecidas são marcadas como descontinuadas (`npm deprecate`).

## Cadeia de suprimentos

- **Poucas dependências de runtime:** cinco (`@sinclair/typebox`, `ajv`, `ajv-formats`, `fast-json-stringify`, `find-my-way`). Uma dependência nova exige justificativa no PR.
- **Versões travadas** pelo `pnpm-lock.yaml`, com instalação `--frozen-lockfile` no CI.
- **`pnpm audit --prod --audit-level=high`** em todo PR: uma vulnerabilidade alta ou crítica nas dependências de produção bloqueia o merge.
- **Dependabot** semanal para npm e GitHub Actions:
  - **runtime:** um PR por atualização, lendo o changelog da dependência antes do merge;
  - **desenvolvimento:** minor e patch agrupadas num PR só;
  - **major:** sempre num PR próprio, com os testes passando nas versões de Node suportadas.
- **Pacote publicado** só com `dist/`, `README`, `LICENSE` e `package.json`, conferido no CI.

# Instalação

- **Node.js 22+**
- **TypeScript 5.2+**, com decorators **padrão** (TC39).
- **ESM** (`"type": "module"`).

::: warning Sem decorators legados
Não use `experimentalDecorators` nem `emitDecoratorMetadata`: se estiverem ligados, o Sashiko lança um erro dizendo como corrigir. Por isso ele não convive no mesmo projeto com bibliotecas que exigem decorators legados, como NestJS e TypeORM.
:::

```bash
pnpm add sashiko
```
_(O TypeBox já vem incluído e re-exportado como `Type`, `Static` e `TSchema`)_

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

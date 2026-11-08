# Instalação

<Aprenda>Instalar o pacote, configurar o TypeScript para os decorators padrão e subir a primeira API.</Aprenda>

- **Node.js 22.12+**
- **TypeScript 5.2+**, com decorators **padrão** (TC39).
- **ESM ou CommonJS:** em projeto CommonJS, o pacote carrega pelo `require()` de módulos ESM do Node (veja [Projeto em CommonJS](./vindo-do-express#projeto-em-commonjs)).

::: warning Sem decorators legados
Não use `experimentalDecorators` nem `emitDecoratorMetadata`: se estiverem ligados, o FlowingTS lança um erro dizendo como corrigir. Por isso ele não convive no mesmo projeto com bibliotecas que exigem decorators legados, como NestJS e TypeORM.
:::

```bash
pnpm add flowingts
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

Importe `flowingts` **antes** de declarar as classes de rotas: o pacote instala o shim de `Symbol.metadata`, necessário para os decorators guardarem as rotas. Com `import { Router } from 'flowingts'` isso já acontece.

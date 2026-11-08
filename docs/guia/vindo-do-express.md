# Vindo do Express

Um guia rápido para quem tem uma API em Express e quer experimentar o FlowingTS sem reescrever tudo de uma vez.

## O que muda

| No Express                                       | No FlowingTS                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `express.Router()` e `router.get(path, handler)` | Uma classe com `@Router('/prefixo')` e `@Get(path)`, registrada com `app.mount()`        |
| `(req, res, next)`                               | `(ctx, next)`; o handler devolve o corpo da resposta ou usa `ctx.json()`                 |
| `req.params`, `req.query`, `req.body`            | `ctx.params`, `ctx.query`, `ctx.body`, já validados e tipados pelo contrato da rota      |
| `express.json()`                                 | Já vem ligado, com limite de tamanho (`bodyLimit`) e proteção contra prototype pollution |
| `helmet`                                         | Headers de segurança ligados por padrão (`securityHeaders`)                              |
| `cors`                                           | O middleware `cors({ origin })`                                                          |
| `express-rate-limit`                             | O middleware `rateLimit({ max, windowMs })`                                              |
| `morgan`                                         | `createApp({ logRequests: true })`, com request id em cada log                           |
| `multer`                                         | `files` no contrato da rota, com `ctx.file()` (veja [Upload de arquivos](./uploads))     |
| `express.static`                                 | `app.static('/prefixo', pasta)`                                                          |
| Middleware de erro `(err, req, res, next)`       | `app.onError()`; as respostas de erro saem em Problem Details                            |
| `swagger-jsdoc` e `swagger-ui-express`           | `app.openapi({ docs: true })`, gerado dos contratos das rotas                            |
| Healthcheck e shutdown escritos à mão            | `app.health()` e shutdown gracioso ligado por padrão                                     |

## Projeto em CommonJS

Não é preciso converter o backend para ESM. A partir do Node.js 22.12, um projeto CommonJS carrega o FlowingTS com `require()`, e o TypeScript compilando para CommonJS emite os decorators normalmente:

```jsonc
// tsconfig.json de um backend CommonJS (package.json sem "type": "module")
{
  "compilerOptions": {
    "target": "es2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true
  }
}
```

O código continua com `import { createApp, Get, Router } from 'flowingts'`; o TypeScript o transforma em `require()`. Requer o FlowingTS 0.16.1 ou mais recente e o Node.js 22.12 ou mais recente.

## Schemas em Zod

Se os schemas já estão em Zod, por exemplo num pacote compartilhado com o site e o app, use o motor `contracts.standard()`: os mesmos schemas viram o contrato das rotas, com os tipos e a validação do próprio Zod.

```ts
import { z } from 'zod';
import { type Context, contracts, createApp, Post, Router, type RouteSchemas } from 'flowingts';
import { Membro } from '@igreja/shared'; // um z.object(...) que já existe

const app = createApp({
  contracts: contracts.standard({ toJSONSchema: (schema) => z.toJSONSchema(schema as z.ZodType) }),
});

const criar = { body: Membro, response: { 201: z.object({ ok: z.boolean() }) } } satisfies RouteSchemas;

@Router('/membros')
class MembroRoutes {
  @Post('/', criar)
  criar(ctx: Context<typeof criar>) {
    return { ok: true }; // ctx.body tem o tipo de z.infer<typeof Membro>
  }
}
```

`.transform()`, `.refine()` (inclusive assíncrono) e `.default()` funcionam, porque quem valida é o próprio Zod. Nos params e na query, use `z.coerce.number()`. Os detalhes estão em [Schemas](./schemas#zod-valibot-e-arktype-o-motor-dos-contratos).

O motor é um por app: com `contracts.standard()`, todas as rotas usam Standard Schema. Para manter o motor nativo (TypeBox) e reaproveitar só alguns schemas Zod, converta-os para JSON Schema:

```ts
const fromZod = <T>(schema: z.ZodType<T>) => Type.Unsafe<T>(z.toJSONSchema(schema, { target: 'draft-7' }));
const criar = { body: fromZod(Membro), response: { 201: Type.Object({ ok: Type.Boolean() }) } } satisfies RouteSchemas;
```

Nesse caso, só o que o JSON Schema expressa é convertido: `.transform()` e `.refine()` ficam de fora e precisam continuar no handler.

## Middlewares do Express (multer e outros)

O upload já é nativo: com `files` no contrato, o arquivo e os campos do formulário são validados antes do handler e tipados ([Upload de arquivos](./uploads)). Para manter o `multer` de um projeto que já existe, ou qualquer outro middleware do Express, use um adaptador.

Um middleware do Express que só lê a requisição e escreve nela pode rodar dentro do FlowingTS com um adaptador. É o caso do `multer`, para upload de arquivos:

```ts
import multer from 'multer';
import type { Middleware } from 'flowingts';

/** Roda um middleware do Express (req, res, next) como middleware do FlowingTS. */
const express =
  (mw: (req: unknown, res: unknown, next: (err?: unknown) => void) => void): Middleware =>
  (ctx, next) =>
    new Promise<void>((ok, fail) => mw(ctx.req, ctx.res, (err) => (err ? fail(err) : ok()))).then(next);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.mount(DocumentoRoutes, { middlewares: [express(upload.single('pdf'))] });
// No handler: o arquivo em (ctx.req as any).file e os campos do formulário em (ctx.req as any).body.
```

- Numa rota sem `files`, o corpo `multipart/form-data` não é lido pelo FlowingTS, então chega intacto ao `multer`.
- Os campos do formulário não têm a validação nem os tipos do contrato da rota; valide-os no handler.
- O limite de tamanho do arquivo é o do `multer` (`limits.fileSize`), e não o `bodyLimit`.
- Middlewares que dependem de recursos próprios do Express (`req.app`, `res.render`, `res.locals`) não funcionam assim.

## Como experimentar sem arriscar a produção

1. Crie um backend novo, ao lado do atual, usando o mesmo banco e os mesmos pacotes compartilhados.
2. Migre poucas rotas primeiro (healthcheck, login, leituras) e publique-as num prefixo separado, como `/api-beta`.
3. Rode os mesmos testes contra as duas APIs e compare latência, memória, as mensagens de erro e quanto código de validação e de documentação deixou de ser escrito.
4. Só depois decida o que migrar.

# Introdução

Micro-framework HTTP para Node.js com **decorators nativos (TC39)**, **schema-first** e **seguro por padrão**.

> **Por que Flowing:** num projeto Express que passa por muitas mãos, cada pessoa declara rotas do seu jeito, e quem chega precisa reaprender cada pedaço. O NestJS resolve a padronização, mas traz junto uma estrutura que muitos projetos não precisam. O Flowing dá **uma forma só de declarar rotas**, que qualquer pessoa da equipe reconhece, com o contrato de cada rota validado como no Fastify e sem tirar a liberdade do Express. O código flui igual, não importa quem o escreveu.

Flowing combina a flexibilidade do **Fastify** e do **Express** (middlewares simples, partes plugáveis, pouca cerimônia) com a organização em classes do **NestJS**, mantendo o núcleo pequeno: `node:http` direto e sete dependências de runtime.

```ts
import { type Context, createApp, Post, Router, type RouteSchemas, Type } from 'flowingts';

const User = Type.Object({ id: Type.String(), name: Type.String() });
const create = {
  body: Type.Object({ name: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  response: { 201: User },
} satisfies RouteSchemas;

@Router('/users')
class UserRoutes {
  @Post('/', create)
  create(ctx: Context<typeof create>) {
    return { id: crypto.randomUUID(), name: ctx.body.name }; // ctx.body tipado; responde 201
  }
}

const app = createApp().mount(UserRoutes);
await app.listen({ port: 3000 });
```

## Princípios

1. **Micro:** núcleo pequeno, com sete dependências de runtime (`@sinclair/typebox`, `ajv`, `ajv-formats`, `fast-json-stringify`, `find-my-way`, `@fastify/busboy` e `magic-bytes.js`). O TypeBox é re-exportado (`Type`, `Static`, `TSchema`), então não precisa ser instalado à parte.
2. **Só decorators padrão (TC39):** sem `reflect-metadata`.
3. **Schema-first:** o schema é a fonte da validação, da serialização e dos tipos.
4. **Seguro por padrão:** desligar uma proteção é sempre explícito.
5. **Node nativo:** `node:http` direto.
6. **Explícito em vez de mágico:** rotas e dependências registradas à mão, no ponto de composição, sem varredura de arquivos.

**Extensões:** quando um recurso tem alternativas populares, o core traz uma implementação leve e um ponto de extensão; a biblioteca externa fica a critério do seu projeto. Estão planejados um parser de query plugável (para usar `qs`) e um validador plugável (Zod, Valibot e ArkType via Standard Schema).

**Fora do escopo:** container de DI, módulos e providers; decorators de parâmetro (`@Body`, `@Param`), porque a interface é o `ctx`; interceptors, pipes e exception filters como conceitos separados; ORM, views e SSR, CLI geradora, GraphQL e WebSockets no core, compatibilidade com middlewares do Express, Bun, Deno e edge (por enquanto).

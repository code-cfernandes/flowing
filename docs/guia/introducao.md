# Introdução

Micro-framework HTTP para Node.js com **decorators nativos (TC39)**, **schema-first** e **seguro por padrão**.

> **Sashiko** (刺し子) é uma técnica japonesa de bordado em que os pontos decorativos também **reforçam** o tecido. É a ideia do framework: os decorators organizam a API e, ao mesmo tempo, trazem validação e proteções seguras por padrão.

Sashiko combina a flexibilidade do **Fastify** e do **Express** (middlewares simples, partes plugáveis, pouca cerimônia) com a organização em classes do **NestJS**, mantendo o núcleo pequeno: `node:http` direto e só cinco dependências de runtime.

```ts
import { type Context, createApp, Post, Router, type RouteSchemas, Type } from 'sashiko';

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

1. **Micro:** núcleo pequeno, com cinco dependências de runtime (`@sinclair/typebox`, `ajv`, `ajv-formats`, `fast-json-stringify`, `find-my-way`). O TypeBox é re-exportado (`Type`, `Static`, `TSchema`), então não precisa ser instalado à parte.
2. **Só decorators padrão (TC39):** sem `reflect-metadata`.
3. **Schema-first:** o schema é a fonte da validação, da serialização e dos tipos.
4. **Seguro por padrão:** desligar uma proteção é sempre explícito.
5. **Node nativo:** `node:http` direto.
6. **Explícito em vez de mágico:** rotas e dependências registradas à mão, no ponto de composição, sem varredura de arquivos.

**Extensões:** quando um recurso tem alternativas populares, o core traz uma implementação leve e um ponto de extensão; a biblioteca externa fica a critério do seu projeto. Estão planejados um parser de query plugável (para usar `qs`) e um validador plugável (Zod, Valibot e ArkType via Standard Schema).

**Fora do escopo:** container de DI, módulos e providers; decorators de parâmetro (`@Body`, `@Param`), porque a interface é o `ctx`; interceptors, pipes e exception filters como conceitos separados; ORM, views e SSR, CLI geradora, GraphQL e WebSockets no core, compatibilidade com middlewares do Express, Bun, Deno e edge (por enquanto).

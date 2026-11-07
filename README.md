# Sashiko

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

## Documentação

**[code-cfernandes.github.io/sashiko](https://code-cfernandes.github.io/sashiko/)**

|                                                                                                                                                                                                                            |                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [Introdução](https://code-cfernandes.github.io/sashiko/guia/introducao) e [instalação](https://code-cfernandes.github.io/sashiko/guia/instalacao)                                                                          | Princípios, requisitos e o primeiro app                                    |
| [Rotas e composição](https://code-cfernandes.github.io/sashiko/guia/rotas)                                                                                                                                                 | `@Router`, `app.mount()`, `app.group()`, virtual hosts e mapeamento manual |
| [Schemas](https://code-cfernandes.github.io/sashiko/guia/schemas) e [respostas](https://code-cfernandes.github.io/sashiko/guia/respostas)                                                                                  | Validação, serialização, tipos do `ctx` e outros formatos                  |
| [Middlewares e guards](https://code-cfernandes.github.io/sashiko/guia/middlewares-e-guards), [hooks](https://code-cfernandes.github.io/sashiko/guia/hooks) e [erros](https://code-cfernandes.github.io/sashiko/guia/erros) | O pipeline da requisição                                                   |
| [Estáticos e streaming](https://code-cfernandes.github.io/sashiko/guia/estaticos-e-streaming)                                                                                                                              | Arquivos, SSE, NDJSON e `ctx.signal`                                       |
| [OpenAPI](https://code-cfernandes.github.io/sashiko/guia/openapi), [logs](https://code-cfernandes.github.io/sashiko/guia/logs) e [observabilidade](https://code-cfernandes.github.io/sashiko/guia/observabilidade)         | Documentação da API, logs correlacionados e OpenTelemetry                  |
| [Segurança](https://code-cfernandes.github.io/sashiko/guia/seguranca), [ciclo de vida](https://code-cfernandes.github.io/sashiko/guia/ciclo-de-vida) e [deploy](https://code-cfernandes.github.io/sashiko/guia/deploy)     | Defaults seguros, HTTPS, healthchecks, shutdown e produção                 |
| [Referência](https://code-cfernandes.github.io/sashiko/referencia/create-app)                                                                                                                                              | `createApp(options)` e a API completa, gerada do código                    |

## Instalação

- **Node.js 22+**
- **TypeScript 5.2+**, com decorators **padrão**. **Não** use `experimentalDecorators` nem `emitDecoratorMetadata`: se estiverem ligados, o Sashiko lança um erro dizendo como corrigir. Por isso ele não convive no mesmo projeto com bibliotecas que exigem decorators legados (NestJS, TypeORM…).
- ESM (`"type": "module"`).

```bash
pnpm add sashiko
```

O `tsconfig.json` mínimo e os detalhes estão em [Instalação](https://code-cfernandes.github.io/sashiko/guia/instalacao).

## Desenvolvimento

```bash
pnpm install
pnpm test            # node:test + tsx
pnpm test:coverage   # com limites mínimos de cobertura
pnpm typecheck
pnpm check           # lint + formatação (Biome); pnpm format corrige a formatação
pnpm build           # dist/
```

Para o `git blame` ignorar o commit de formatação: `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

**Publicação:** um push de tag de versão (`git tag v1.2.3 && git push origin v1.2.3`) dispara o workflow `release.yml`. Ele confere que a tag bate com o `package.json`, que o commit está na `main` e que o CHANGELOG tem a seção da versão. Depois roda as mesmas verificações do CI e envia o pacote ao npm em estágio, por Trusted Publishing, sem token e com provenance, além de criar a GitHub Release com as notas do CHANGELOG. A versão só fica pública depois da aprovação no npmjs.com, com o 2FA da conta.

Mudanças notáveis estão no [CHANGELOG](CHANGELOG.md). Para reportar uma vulnerabilidade e conhecer a política de dependências, veja o [SECURITY.md](SECURITY.md).

## Licença

[ISC](LICENSE)

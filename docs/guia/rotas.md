# Rotas e composição

<Aprenda>Declarar rotas em classes, montá-las no app e compor prefixos, grupos, middlewares e hosts.</Aprenda>

As rotas ficam em classes marcadas com `@Router`, a "permissão" para o app usar a classe, que também define o prefixo. Verbo e path ficam no método:

```ts
@Router('/users')
class UserRoutes {
  @Get('/') list() {}
  @Get('/:id') get(ctx: Context) {
    return { id: ctx.params.id };
  }
  @Post('/') create() {}
  @Put('/:id') replace() {}
  @Patch('/:id') update() {}
  @Delete('/:id') remove(ctx: Context) {
    ctx.status(204);
  }
}
```

- **HEAD e OPTIONS automáticos:** toda rota `GET` responde a `HEAD`, sem corpo. `OPTIONS` responde 204 com o header `Allow`.
- **405 e 404:** um método não suportado num path existente recebe 405 com `Allow`; um path inexistente recebe 404.
- **Herança:** uma subclasse (com seu próprio `@Router`) herda as rotas, os middlewares e os guards do pai, com o próprio prefixo, e pode sobrescrever handlers. A classe base não é alterada.

## Registro e composição: `app.mount()`

`app.mount()` é a única porta de entrada. Ele aceita a classe (com construtor sem argumentos) ou uma **instância**, que é como as dependências chegam, sem container de DI. No **ponto de composição** (`server.ts`) você decide como expor cada classe, sem mexer nela:

```ts
const repo = new UserRepository(db);
const userRoutes = new UserRoutes(repo);

app
  .mount(HealthRoutes)
  .mount(userRoutes) // como declarado
  .mount(userRoutes, { prefix: '/v2/users' }) // a mesma instância em outro prefixo
  .mount(userRoutes, { prefix: '/public/users', only: (r) => [r.list, r.get] }) // exposição parcial
  .mount(new AdminRoutes(repo), { middlewares: [authenticate], guards: [isAdmin] }); // regras para o grupo
```

| Opção             | Efeito                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prefix`          | Substitui o prefixo do `@Router`                                                                                                                        |
| `only` / `except` | Registra só os métodos selecionados, ou todos menos esses: `(r) => [r.list, r.get]`. O seletor é checado pelo TypeScript; usar os dois juntos gera erro |
| `auto`            | `false` registra só as [rotas manuais](#mapeamento-manual). Padrão: `true`                                                                              |
| `middlewares`     | Valem para todas as rotas do grupo; rodam antes dos `@Middlewares` da classe                                                                            |
| `guards`          | Valem para todas as rotas do grupo; rodam antes dos `@Guards` da classe                                                                                 |

Erros de registro aparecem na inicialização, com mensagem clara, e **não deixam registros parciais**: se uma rota do `mount()` conflita, nenhuma das outras fica registrada.

- classe sem `@Router`;
- seletor em `only`/`except` que não aponta para um método de rota;
- a mesma classe registrada duas vezes com o mesmo prefixo.

> **Por que `mount` e não `register`?** O método monta um grupo de rotas sob um prefixo, quantas vezes for preciso, como o `koa-mount` e os routers do Express. No Fastify, `register` significa plugin encapsulado, e o FlowingTS não tem um sistema de plugins (veja abaixo).

### Grupos: `app.group()`

Para aplicar prefixo, middlewares e guards a **várias** classes de uma vez:

```ts
app.group({ prefix: '/v2', middlewares: [authenticate], guards: [isAdmin] }, (g) => g.mount(UserRoutes).mount(new OrderRoutes(db)));
// GET /v2/users, GET /v2/orders…
```

- **Prefixos se somam:** grupo, depois o prefixo do `mount()` ou do `@Router`, depois o path do método. O prefixo pode ter parâmetros (`'/orgs/:org'`), conferidos contra o schema de `params`.
- **Ordem de execução:** grupos (de fora para dentro) → `mount()` → classe → método → rota manual. Vale para middlewares e para guards.
- **Encadeamento:** dentro do callback, `g.mount(A).mount(B)` e `.get(...)` continuam no grupo. Grupos podem ser aninhados (`g.group(...)`).
- **O callback é síncrono, e o registro é atômico.** As rotas do grupo só entram se o callback terminar sem erro. Um callback `async`, ou um erro no meio dele, não deixa nenhuma rota registrada. Depois que o callback termina, o `g` (e os `mount()` feitos com ele) não registram mais nada: uma tentativa, por exemplo depois de um `await`, gera erro. Se um grupo aninhado falhar e o externo capturar o erro, só as rotas do aninhado são descartadas. Faça o trabalho assíncrono antes (`const db = await connect()`).
- **Fora do escopo:** middlewares globais (`app.use()`) e hooks (`onError`, `onSend`…) continuam no app.

### Virtual hosts

Domínios diferentes no mesmo app, cada um com as suas rotas:

```ts
createApp({ allowedHosts: ['api.exemplo.com', 'admin.exemplo.com', '*.clientes.exemplo.com'] })
  .group({ host: 'admin.exemplo.com', guards: [isAdmin] }, (g) => g.mount(AdminRoutes).mount(ReportsRoutes))
  .mount(PublicApi, { host: 'api.exemplo.com' })
  .mount(TenantRoutes, { host: '*.clientes.exemplo.com' }) // acme.clientes…, a.b.clientes…
  .mount(HealthRoutes); // sem host: vale para todos
```

- **Regras:** as mesmas do `allowedHosts`. Uma string casa com o hostname exato, sem porta e sem diferenciar maiúsculas. `'*.dominio'` vale para subdomínios de qualquer profundidade, nunca para o domínio em si. Uma RegExp precisa casar o hostname inteiro. Também é possível passar uma lista: `host: ['api.exemplo.com', 'api.exemplo.dev']`.
- **O host usado é o validado** (`ctx.hostname`). Com `trustProxy`, vem do `X-Forwarded-Host` confiável, nunca do header cru.
- **Prioridade, independente da ordem de registro:** host exato → curinga mais específico (`*.api.exemplo.com` antes de `*.exemplo.com`) → RegExp, na ordem de registro → rota sem host, que serve de fallback para qualquer domínio.
- **Isolamento:** as rotas de um host não respondem em outro. O 404 e o 405 (com o `Allow`) são calculados por host.
- **Onde declarar:** no `mount()` ou no `group()`, e não no `@Router`, porque o domínio é uma decisão de deploy. Declarar `host` num grupo e de novo dentro dele gera erro.
- **Alcançável:** se o app tem `allowedHosts`, um `host` de rota sem nenhuma interseção com a lista falha no registro, porque essa rota nunca seria alcançada. `*.clientes.exemplo.com` com `allowedHosts: ['acme.clientes.exemplo.com']` passa, e `allowedHosts: ['api.exemplo.com:8443']` cobre `host: 'api.exemplo.com'`. Quando não dá para provar (RegExp em algum dos lados), o app só avisa no log. `createApp({ unreachableHosts: 'warn' })` transforma o erro em aviso, e `'off'` não confere.
- **OpenAPI por host:** o `/openapi.json` documenta as rotas do host da requisição mais as rotas sem host, sem misturar domínios. Para gerar o arquivo, use `app.openapiDocument({ host: 'api.exemplo.com' })`; sem `host`, saem só as rotas sem host.
- **Com HTTPS:** o `tls.sni` escolhe o certificado no handshake, e o `host` escolhe as rotas na requisição. As duas configurações se complementam.

**Pacotes reutilizáveis, sem sistema de plugins.** Uma função que recebe o app basta, sem API nova, registro de nomes nem ciclo de vida próprio:

```ts
export function audit(app: FlowingApp, opts: { store: AuditStore }) {
  return app.group({ prefix: '/audit', guards: [isAdmin] }, (g) => g.mount(new AuditRoutes(opts.store))).onClose(() => opts.store.flush());
}

audit(app, { store });
```

## Mapeamento manual

Depois do `mount`, os verbos `.get()`, `.post()`, `.put()`, `.patch()` e `.delete()` mapeiam um método da classe para um path que ela não declara: um alias, um endpoint legado, um export. O path é relativo ao prefixo do grupo, e o método é escolhido por um **seletor**, checado pelo TypeScript:

```ts
@Router('/users')
class UserRoutes {
  @Get('/:id', byId) getUser(ctx: Context<typeof byId>) {}
  @Schema(csv) exportCsv(ctx: Context<typeof csv>) {} // sem verbo: só por mapeamento manual
  private findOr404() {} // sem decorator: nunca pode ser exposto
}

app
  .mount(new UserRoutes(repo))
  .get('/legacy/:id', (r) => r.getUser) // GET /users/legacy/:id
  .get('/export.csv', (r) => r.exportCsv, { middlewares: [cache()], guards: [isAuditor] })
  .mount(HealthRoutes); // o encadeamento continua
```

- **Seletor:** funciona com instância (inclusive inline, `mount(new X(repo))`) e com a classe. "Ir para a definição" e renomear no editor funcionam.
- **Permissão por método:** só podem ser mapeados métodos com algum decorator do FlowingTS (verbo, `@Schema`, `@Middlewares` ou `@Guards`). Um método sem decorator gera erro no registro.
- **Regras herdadas:** a rota manual usa os schemas e os `@Middlewares`/`@Guards` do método, e as regras do grupo.
- **Opções da rota:** `{ middlewares, guards }` em objeto, e não uma lista de funções, para que middleware, guard e seletor nunca se confundam.
- **Só mapeamento manual:** `mount(x, { auto: false })` não registra as rotas declaradas na classe.

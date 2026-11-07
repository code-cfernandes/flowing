# Middlewares e guards

Middlewares seguem o modelo do Koa: `(ctx, next) => Promise<void>`.

```ts
app.use(async (ctx, next) => {
  const started = Date.now();
  await next();
  ctx.log.debug({ ms: Date.now() - started }, 'done');
});
```

Por classe ou por método, use `@Middlewares` e `@Guards`; para um grupo inteiro ou uma rota manual, use as opções `middlewares` e `guards`, com os mesmos nomes em todos os níveis. Um guard retorna `true` para seguir, `false` para responder 403, ou lança um `HttpError` (por exemplo, `unauthorized()` para 401).

```ts
declare module 'sashiko' {
  interface ContextState {
    user?: { id: string; role: 'admin' | 'user' };
  } // ctx.state tipado
}

const authenticate: Middleware = async (ctx, next) => {
  ctx.state.user = await verifyToken(ctx.get('authorization'));
  await next();
};
const isAdmin: Guard = (ctx) => ctx.state.user?.role === 'admin';

@Middlewares(authenticate)
@Router('/admin')
class AdminRoutes {
  @Guards(isAdmin)
  @Delete('/users/:id')
  remove() {}
}
```

**Ordem de execução:**

```
globais → mount.middlewares → @Middlewares (classe → método) → rota manual.middlewares
        → mount.guards → @Guards (classe → método) → rota manual.guards
        → validação → handler
```

**Ordem dos decorators no código.** `@Router`, `@Get`/`@Post`/…, `@Schema`, `@Middlewares` e `@Guards` só registram metadata, então a posição entre eles não muda o comportamento; a única regra é que vários `@Middlewares` (ou `@Guards`) executam na ordem em que aparecem, de cima para baixo. Já decorators que **envolvem** o método, como `@timer()`, medem tudo o que estiver abaixo deles.

Os guards rodam **antes** da validação: quem não tem acesso recebe 401/403, e não um 400 que revelaria o formato esperado.

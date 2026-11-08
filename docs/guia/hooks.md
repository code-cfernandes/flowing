# Hooks de ciclo de vida

Para o que acontece **antes** do handler (autenticação, rate limit, preparar o `ctx.state`), use middlewares. Os hooks cobrem o resto:

```ts
app
  .onRequest((ctx) => active.inc()) // no início de toda requisição (síncrono)
  .onSend((ctx, payload) => {
    ctx.header('ETag', etag(payload.body));
  }) // antes de escrever (síncrono)
  .onResponse((ctx, info) => {
    active.dec();
    metrics.observe(ctx.route?.path ?? 'not_found', info.status, info.ms); // o template, nunca ctx.path
  }) // quando a requisição termina, exatamente uma vez
  .onClose(async () => {
    await db.close();
  }); // em qualquer close()
```

- **`onRequest`:** roda no início de cada requisição, antes da validação do `Host` e dos middlewares. Toda requisição que passa por ele também passa pelo `onResponse`. É síncrono: uma Promise devolvida não é esperada. Erros são só logados.
- **`onSend`:** roda imediatamente antes de escrever uma resposta com corpo (exceto streams), inclusive erros e 404. É **síncrono**, como a escrita do pipeline. Pode alterar headers ou devolver `{ body, contentType }` novos. Se lançar, o erro é logado e a resposta original é enviada.
- **`onResponse`:** roda **exatamente uma vez** quando a requisição termina, em todos os caminhos: sucesso, erro, 404/405, `Host` inválido, healthcheck, cancelamento pelo cliente, shutdown, streams e `inject()`. Pode ser assíncrono, porque não atrasa o cliente, e erros são só logados. O segundo argumento traz:

  | Campo                 | Conteúdo                                                                                                                                 |
  | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
  | `status`              | Status enviado                                                                                                                           |
  | `ms`                  | Duração total, até o fim da resposta ou o cancelamento                                                                                   |
  | `outcome`             | `completed`, `aborted` (cancelada antes do fim) ou `error` (respondida com 5xx)                                                          |
  | `abortReason`         | `CLIENT_DISCONNECTED` ou `SHUTDOWN`, quando cancelada                                                                                    |
  | `ttfbMs`              | Tempo até os headers saírem. Em SSE e NDJSON é a latência real; `ms` mede a conexão inteira. Ausente num servidor próprio (`callback()`) |
  | `streaming`           | Resposta em stream: SSE, NDJSON, `Readable` ou arquivo                                                                                   |
  | `route`               | A rota que atendeu (o mesmo `ctx.route`); ausente em 404, 405, healthcheck e OpenAPI                                                     |
  | `error`, `errorPhase` | O erro tratado e a etapa em que ele chegou                                                                                               |

- **`onClose`:** roda em qualquer `close()` (sinal, teste, código), depois que o servidor fecha e antes do `shutdown.onShutdown`. Todos os hooks rodam mesmo se algum falhar, e o `close()` rejeita ao final.

## Hooks com escopo

Os mesmos `onSend`, `onResponse` e `onError` valem para um grupo, um `mount()`, uma classe, um método ou uma rota manual, com a mesma assinatura dos hooks do app:

```ts
import { Get, OnError, OnResponse, OnSend, Router } from 'flowingts';

@Router('/orders')
@OnResponse((ctx, info) => metrics.orders.observe(info.ms)) // todas as rotas da classe
class OrderRoutes {
  @Get('/:id/invoice')
  @OnSend((ctx) => void ctx.header('Cache-Control', 'private, max-age=60')) // só esta rota
  @OnError((err, ctx, phase) => audit.invoiceFailed(err, phase))
  invoice() {}
}

app.group({ prefix: '/admin', guards: [isAdmin], hooks: { onResponse: auditAdmin } }, (g) => g.mount(AdminRoutes));
app.mount(Reports, { hooks: { onSend: signPayload } });
app.mount(Legacy).get('/old/:id', (r) => r.get, { hooks: { onError: [logLegacy, alertLegacy] } });
```

- **Quando rodam:** só quando uma rota daquele escopo atendeu. Um 404, um 405, um `Host` inválido, um healthcheck ou o OpenAPI nunca chegam a eles; os hooks do app continuam vendo tudo.
- **Ordem:** de fora para dentro, como os middlewares (grupo → `mount()` → classe → método → rota manual).

  | Hook         | Ordem                                      | Interrupção                                                   |
  | ------------ | ------------------------------------------ | ------------------------------------------------------------- |
  | `onSend`     | app → escopo, de fora para dentro          | Cada um recebe o payload do anterior                          |
  | `onError`    | escopo, do mais específico para fora → app | O primeiro que responder encerra a cadeia e a resposta padrão |
  | `onResponse` | app → escopo                               | Todos rodam                                                   |

- **Herança:** uma subclasse herda os hooks da classe pai, e os que ela acrescenta não alteram a pai.
- **Erro antes do roteamento**, num middleware global: ainda não há rota, então só os `onError` do app rodam.
- **Custo:** as listas de cada rota são montadas no registro. Uma rota sem hooks não paga nada, e só um `onResponse` (do app ou de alguma rota) faz o app acompanhar o fim das requisições.

**E o `onRequest`?** Ele roda antes do roteamento, quando a rota ainda não é conhecida, então não existe com escopo. Para algo no início das requisições de um escopo, use um middleware desse escopo: `@Middlewares(fn)`, ou `middlewares` no `group()` e no `mount()`.

**Regras junto da classe, sem tirar a composição do lugar.** Os grupos são montados no `app.group()`, e não por um decorator na classe: assim a mesma classe pode ser montada em dois grupos, e uma regra de segurança não depende de lembrar de um decorator. Para ler os guards e hooks junto da classe, combine os decorators numa função:

```ts
const AdminArea = () => (cls: Function, ctx: ClassDecoratorContext) => {
  Guards(isAdmin)(cls, ctx);
  OnResponse(auditAdmin)(cls, ctx);
};

@AdminArea()
@Router('/users')
class AdminUsers {}
```

**Cache com middleware.** Depois do `await next()`, `ctx.sentBody` e `ctx.sentType` contêm o corpo exatamente como foi enviado, já filtrado pelo schema:

```ts
const cache =
  (ttlMs: number): Middleware =>
  async (ctx, next) => {
    const hit = store.get(ctx.url.href);
    if (hit) return void ctx.header('X-Cache', 'HIT').send(hit.body, hit.type);
    ctx.header('X-Cache', 'MISS'); // headers antes do next(): depois dele a resposta já foi enviada
    await next();
    if (ctx.res.statusCode === 200 && ctx.sentBody) store.set(ctx.url.href, { body: ctx.sentBody, type: ctx.sentType! });
  };
app.mount(products, { middlewares: [cache(60_000)] });
```

| Fastify      | Flowing                                                           |
| ------------ | ----------------------------------------------------------------- |
| `onRequest`  | `app.onRequest` (observação) ou middlewares (para interromper)    |
| `preHandler` | middlewares (`app.use`, `mount({ middlewares })`, `@Middlewares`) |
| `onError`    | `app.onError`                                                     |
| `onSend`     | `app.onSend` (síncrono)                                           |
| `onResponse` | `app.onResponse`                                                  |
| `onClose`    | `app.onClose`                                                     |

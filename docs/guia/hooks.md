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

| Fastify      | Sashiko                                                           |
| ------------ | ----------------------------------------------------------------- |
| `onRequest`  | `app.onRequest` (observação) ou middlewares (para interromper)    |
| `preHandler` | middlewares (`app.use`, `mount({ middlewares })`, `@Middlewares`) |
| `onError`    | `app.onError`                                                     |
| `onSend`     | `app.onSend` (síncrono)                                           |
| `onResponse` | `app.onResponse`                                                  |
| `onClose`    | `app.onClose`                                                     |

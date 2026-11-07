# Arquivos estáticos e streaming

## Arquivos estáticos

```ts
app.static('/assets', './public', { maxAge: '7d', immutable: true });
app.static('/', './dist', { fallback: 'index.html' }); // SPA (use securityHeaders: 'web')

app.group({ host: 'cdn.exemplo.com', guards: [auth] }, (g) => g.static('/files', './uploads'));
```

- **São rotas de verdade (`GET`/`HEAD prefix/*`):** valem `group()` (host, guards, middlewares), 404/405 e a checagem de conflitos. Não entram no OpenAPI.
- **Segurança:**
  - o caminho precisa ficar dentro da raiz, inclusive depois de seguir symlinks;
  - `..` (também codificado), barra invertida e byte nulo são recusados;
  - arquivos ocultos (`.env`, `.git`) respondem 404 por padrão (`dotfiles: 'allow'` libera);
  - diretórios nunca são listados (o `index`, padrão `index.html`, é servido quando existe).
- **HTTP:**
  - `ETag` e `Last-Modified`, com 304 para `If-None-Match` e `If-Modified-Since`;
  - `Range` de um intervalo (206, ou 416 fora do arquivo), com `If-Range`, para vídeo e downloads retomáveis;
  - `Cache-Control` por `maxAge` (`'7d'`, `'12h'`, segundos) e `immutable`;
  - `Content-Type` por uma tabela interna, ampliável com `mimeTypes`.
- **SPA:** `fallback` serve o arquivo só quando o path **não tem extensão** (`/pedidos/42` → `index.html`), com `no-cache`. Um asset que falta (`/app.js`) continua 404.
- **Raiz inexistente ou `maxAge` inválido** falham na configuração.
- **Páginas HTML:** os headers de segurança padrão (`'api'`) bloqueiam scripts. Para servir uma SPA, use `createApp({ securityHeaders: 'web' })`.

Num handler, para downloads controlados pela aplicação:

```ts
@Get('/reports/:id')
download(ctx: Context<'/reports/:id'>) {
  return ctx.sendFile(`${ctx.params.id}.pdf`, { root: './reports', download: 'relatório.pdf' });
}
```

Com `root`, o path é relativo e não pode sair dela. Sem `root`, ele precisa ser absoluto. `download` envia `Content-Disposition: attachment`, com o nome em UTF-8.

**Compressão:** fica a cargo da aplicação ou da infraestrutura (proxy, CDN). O core não comprime respostas.

## Server-Sent Events

```ts
@Get('/events')
events(ctx: Context) {
  const stream = ctx.sse({ heartbeatMs: 15_000 });
  const off = bus.on('order', (o) => stream.send({ event: 'order', id: o.id, data: o }));
  stream.onClose(off);
}
```

- **Headers:** já vêm configurados, inclusive `X-Accel-Buffering: no` para o Nginx não segurar os eventos.
- **Eventos:** `data` em objeto vira JSON, e texto com várias linhas é dividido. `event` e `id` com quebra de linha geram erro, porque seria injeção de evento.
- **Conexão:** o heartbeat (`: ping`) mantém a conexão viva atrás de proxies. `stream.lastEventId` traz o `Last-Event-ID` da reconexão.
- **Encerramento:** `stream.onClose()` roda quando o cliente desconecta, quando o handler chama `close()` ou quando o app encerra.

## Respostas em stream

- **`Readable`:** `ctx.send(readable, type)` ou `return readable`, com backpressure.
- **Async iterable → NDJSON:** um handler que retorna um async generator (ou um cursor de banco) responde em `application/x-ndjson`, uma linha JSON por item:

  ```ts
  @Get('/export', { response: { 200: { contentType: 'application/x-ndjson', schema: Row } } })
  async *export(ctx: Context) { for await (const row of db.cursor({ signal: ctx.signal })) yield row; }
  ```

  Com schema, cada item é validado e os campos não declarados são removidos. Uma rota com schema JSON comum que retorna um iterable gera erro, orientando a declarar `application/x-ndjson`.

## `ctx.signal` e encerramento

- **`ctx.signal`** é um `AbortSignal` cancelado quando o cliente desconecta antes do fim da resposta. Passe-o a consultas e `fetch` longos, para não continuar um trabalho que ninguém vai ler.
- **Motivo:** `ctx.signal.reason` é um `RequestAbortedError` com `code`: `CLIENT_DISCONNECTED` ou `SHUTDOWN`. `ctx.abortReason` é o atalho tipado:

  ```ts
  ctx.signal.addEventListener('abort', () => {
    if (ctx.abortReason === 'SHUTDOWN') queue.requeue(job); // o app está encerrando: devolve o trabalho
  });
  ```

- **No shutdown:** os streams já iniciados (SSE, NDJSON) recebem o cancelamento e fecham na hora, em vez de segurar o encerramento até o prazo. Requisições comuns continuam até terminar.

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it, mock } from 'node:test';
import { type Context, Router, createApp, Get } from 'flowingts';
import { startServer } from '../helpers/server.ts';

@Router('/h')
class H {
  @Get('/text') text(ctx: Context) {
    return ctx.status(201).text('olá');
  }
  @Get('/header') header(ctx: Context) {
    ctx.header('X-Total', '42').header('Cache-Control', 'no-store');
    return { ok: true };
  }
  @Get('/get') get(ctx: Context) {
    return { agent: ctx.get('X-Agent') ?? null, missing: ctx.get('x-nope') ?? null };
  }
  @Get('/buffer') buffer(ctx: Context) {
    ctx.send(Buffer.from([1, 2, 3]));
  }
  @Get('/csv') csv(ctx: Context) {
    ctx.send('a,b\n1,2\n', 'text/csv; charset=utf-8');
  }
  @Get('/redirect') redirect(ctx: Context) {
    ctx.redirect('/h/text');
  }
  @Get('/moved') moved(ctx: Context) {
    ctx.redirect('https://exemplo.com/novo', 301);
  }
  @Get('/stream') stream(ctx: Context) {
    // Gera os dados de forma assíncrona: o handler retorna antes do fim do stream.
    ctx.send(
      Readable.from(
        (async function* () {
          for (const part of ['um,', 'dois,', 'três']) {
            await new Promise((r) => setTimeout(r, 10));
            yield part;
          }
        })(),
      ),
      'text/plain; charset=utf-8',
    );
  }
  @Get('/stream-error') streamError(ctx: Context) {
    ctx.send(
      Readable.from(
        (async function* () {
          yield 'começo';
          throw new Error('disk failure');
        })(),
      ),
    );
  }
  @Get('/twice') twice(ctx: Context) {
    ctx.text('primeiro');
    ctx.text('segundo');
    return { ignored: true };
  }
}

const app = createApp().mount(H);

describe('F-10 · helpers do ctx', () => {
  it('text() com status', async () => {
    const res = await app.inject('/h/text');
    assert.equal(res.status, 201);
    assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(res.body, 'olá');
  });

  it('header() define headers da resposta e mantém o retorno JSON', async () => {
    const res = await app.inject('/h/header');
    assert.equal(res.headers['x-total'], '42');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(res.json(), { ok: true });
  });

  it('get() lê headers da requisição sem diferenciar maiúsculas', async () => {
    const res = await app.inject({ url: '/h/get', headers: { 'x-agent': 'curl' } });
    assert.deepEqual(res.json(), { agent: 'curl', missing: null });
  });

  it('send(Buffer) usa application/octet-stream por padrão', async () => {
    const res = await app.inject('/h/buffer');
    assert.equal(res.headers['content-type'], 'application/octet-stream');
    assert.equal(res.body, '\u0001\u0002\u0003');
  });

  it('send(string, contentType)', async () => {
    const res = await app.inject('/h/csv');
    assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal(res.body, 'a,b\n1,2\n');
  });

  it('redirect() padrão 302 e com status explícito', async () => {
    const r1 = await app.inject('/h/redirect');
    assert.equal(r1.status, 302);
    assert.equal(r1.headers.location, '/h/text');
    const r2 = await app.inject('/h/moved');
    assert.equal(r2.status, 301);
    assert.equal(r2.headers.location, 'https://exemplo.com/novo');
  });

  it('chamadas depois do envio são ignoradas e o retorno do handler não é serializado', async () => {
    const res = await app.inject('/h/twice');
    assert.equal(res.body, 'primeiro');
  });

  it('stream assíncrono chega completo (o framework não corta a resposta)', async () => {
    const srv = await startServer(createApp().mount(H));
    try {
      const res = await fetch(srv.url + '/h/stream');
      assert.equal(await res.text(), 'um,dois,três');
    } finally {
      await srv.close();
    }
  });

  it('erro no meio do stream encerra a conexão e loga, sem derrubar o processo', async () => {
    const errorLog = mock.method(console, 'error', () => {});
    const srv = await startServer(createApp().mount(H));
    try {
      await assert.rejects(async () => {
        const res = await fetch(srv.url + '/h/stream-error');
        await res.text();
      });
      assert.ok(errorLog.mock.calls.some((c) => (c.arguments[1] as { err?: Error }).err?.message === 'disk failure'));
    } finally {
      errorLog.mock.restore();
      await srv.close();
    }
  });
});

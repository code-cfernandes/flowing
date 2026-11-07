import { Type } from '@sinclair/typebox';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { type Context, Router, createApp, Get, Post, Schema } from 'sashiko';

@Router('/l')
class L {
  @Get('/') hello(ctx: Context) {
    return { ip: ctx.ip, q: ctx.query };
  }
  @Post('/') @Schema({ body: Type.Object({ n: Type.Integer() }) }) echo(ctx: Context) {
    return ctx.body;
  }
  @Get('/slow') async slow() {
    await new Promise((r) => setTimeout(r, 150));
    return { done: true };
  }
}

describe('F-09 · listen / close / callback', () => {
  it('listen() resolve com o servidor já aceitando conexões', async () => {
    const app = createApp().mount(L);
    const server = await app.listen({ port: 0 });
    try {
      const { port } = server.address() as AddressInfo;
      assert.equal((await fetch(`http://127.0.0.1:${port}/l`)).status, 200);
    } finally {
      await app.close();
    }
  });

  it('listen() rejeita se a porta estiver ocupada', async () => {
    const a = createApp();
    const server = await a.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
      await assert.rejects(createApp().listen(port), /EADDRINUSE/);
    } finally {
      await a.close();
    }
  });

  it('listen() duas vezes no mesmo app gera erro', async () => {
    const app = createApp();
    await app.listen(0);
    try {
      await assert.rejects(app.listen(0), /already listening/);
    } finally {
      await app.close();
    }
  });

  it('close() espera as requisições em andamento terminarem', async () => {
    const app = createApp().mount(L);
    const server = await app.listen(0);
    const { port } = server.address() as AddressInfo;
    const pending = fetch(`http://127.0.0.1:${port}/l/slow`);
    await new Promise((r) => setTimeout(r, 30));
    await app.close();
    const res = await pending;
    assert.deepEqual(await res.json(), { done: true });
  });

  it('close(): a resposta em andamento numa conexão keep-alive sai com Connection: close', async () => {
    const app = createApp({ logger: false, shutdown: false }).mount(L);
    const server = await app.listen(0);
    const { port } = server.address() as AddressInfo;
    const agent = new http.Agent({ keepAlive: true });
    try {
      const pending = new Promise<{ connection: string | undefined; socketClosed: Promise<void> }>((resolve, reject) => {
        const req = http.get({ port, path: '/l/slow', agent }, (res) => {
          res.resume();
          const socketClosed = new Promise<void>((done) => res.socket.once('close', () => done()));
          res.on('end', () => resolve({ connection: res.headers.connection, socketClosed }));
        });
        req.on('error', reject);
      });
      await new Promise((r) => setTimeout(r, 30));
      const t0 = Date.now();
      await app.close(3_000);
      assert.ok(Date.now() - t0 < 1_000, 'o close() não espera o prazo de força');
      const { connection, socketClosed } = await pending;
      assert.equal(connection, 'close');
      await socketClosed;
    } finally {
      agent.destroy();
      await app.close();
    }
  });

  it('close() sem listen é no-op', async () => {
    await createApp().close();
  });

  it('callback() funciona com um servidor criado pelo usuário', async () => {
    const app = createApp().mount(L);
    const server = http.createServer(app.callback());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const { port } = server.address() as AddressInfo;
      assert.equal((await fetch(`http://127.0.0.1:${port}/l`)).status, 200);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe('F-09 · inject() sem rede', () => {
  const app = createApp().mount(L);

  it('GET com query e IP simulado', async () => {
    const res = await app.inject({ url: '/l?a=1&a=2', remoteAddress: '10.0.0.7' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { ip: '10.0.0.7', q: { a: ['1', '2'] } });
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });

  it('atalho com string', async () => {
    assert.equal((await app.inject('/nada')).status, 404);
  });

  it('POST com objeto vira JSON automaticamente', async () => {
    const res = await app.inject({ method: 'POST', url: '/l', body: { n: 5 } });
    assert.deepEqual(res.json(), { n: 5 });
  });

  it('body string/crua com content-type explícito', async () => {
    const res = await app.inject({ method: 'POST', url: '/l', body: '{oops', headers: { 'Content-Type': 'application/json' } });
    assert.equal(res.status, 400);
    assert.deepEqual(res.json(), { type: 'about:blank', title: 'Bad Request', status: 400, detail: 'Invalid JSON', code: 'INVALID_JSON' });
  });

  it('HEAD não traz corpo', async () => {
    const res = await app.inject({ method: 'HEAD', url: '/l' });
    assert.equal(res.status, 200);
    assert.equal(res.body, '');
  });

  it('validação continua funcionando', async () => {
    const res = await app.inject({ method: 'POST', url: '/l', body: { n: 'x' } });
    assert.equal(res.status, 400);
    assert.equal(res.json<{ detail: string }>().detail, 'Invalid body');
  });
});

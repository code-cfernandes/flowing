import { Type } from '@sinclair/typebox';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it, mock } from 'node:test';
import { createApp, Get, type Middleware, Router, type RouteSchemas } from 'sashiko';

const one = { response: { 200: Type.Object({ id: Type.String() }) } } satisfies RouteSchemas;
let calls = 0;

@Router('/h')
class H {
  @Get('/user', one) user() {
    calls++;
    return { id: '1', password: 'hash' };
  }
  @Get('/text') text() {
    return 'olá';
  }
  @Get('/stream') stream() {
    return Readable.from(['a', 'b']);
  }
  @Get('/boom') boom() {
    throw new Error('x');
  }
  @Get('/slow') async slow() {
    await new Promise((r) => setTimeout(r, 20));
    return { ok: true };
  }
}

describe('F-04 · ctx.sentBody e cache por middleware', () => {
  // Cache mínimo em memória, como no exemplo da spec
  const store = new Map<string, { body: Buffer; type: string }>();
  const cache: Middleware = async (ctx, next) => {
    const hit = store.get(ctx.url.href);
    if (hit) return void ctx.header('X-Cache', 'HIT').send(hit.body, hit.type);
    ctx.header('X-Cache', 'MISS'); // antes do next(): depois dele, a resposta já foi enviada
    await next();
    if (ctx.res.statusCode === 200 && ctx.sentBody) store.set(ctx.url.href, { body: ctx.sentBody, type: ctx.sentType! });
  };

  it('grava na primeira chamada e responde do cache na segunda, sem campos não declarados', async () => {
    calls = 0;
    const app = createApp({ logger: false }).mount(H, { middlewares: [cache], only: (r) => [r.user] });
    const first = await app.inject('/h/user');
    const second = await app.inject('/h/user');
    assert.equal(calls, 1, 'o handler rodou uma vez só');
    assert.equal(second.headers['x-cache'], 'HIT');
    assert.equal(second.body, '{"id":"1"}', 'o cache guardou o corpo já filtrado pelo schema');
    assert.equal(second.headers['content-type'], first.headers['content-type']);
  });

  it('sentBody fica vazio em streams', async () => {
    let seen: unknown = 'nada';
    const spy: Middleware = async (ctx, next) => {
      await next();
      seen = ctx.sentBody;
    };
    await createApp({ logger: false }).use(spy).mount(H).inject('/h/stream');
    assert.equal(seen, undefined);
  });
});

describe('F-04 · onSend', () => {
  it('altera headers e corpo antes de escrever, inclusive em erros e 404', async () => {
    const app = createApp({ logger: false })
      .onSend((ctx, payload) => {
        ctx.header('ETag', `"${createHash('sha1').update(payload.body).digest('hex').slice(0, 8)}"`);
      })
      .onSend((_ctx, payload) =>
        payload.contentType.startsWith('text/plain')
          ? { body: String(payload.body).toUpperCase(), contentType: payload.contentType }
          : payload,
      )
      .mount(H);
    const text = await app.inject('/h/text');
    assert.equal(text.body, 'OLÁ');
    assert.match(String(text.headers['etag']), /^"[0-9a-f]{8}"$/);
    assert.ok((await app.inject('/h/boom')).headers['etag'], 'erro também passa pelo onSend');
    assert.ok((await app.inject('/nada')).headers['etag'], '404 também passa pelo onSend');
  });

  it('não roda para streams', async () => {
    let ran = false;
    await createApp({ logger: false })
      .onSend(() => {
        ran = true;
      })
      .mount(H)
      .inject('/h/stream');
    assert.equal(ran, false);
  });

  it('se um onSend lançar, loga e envia a resposta original', async () => {
    const errorLog = mock.method(console, 'error', () => {});
    try {
      const app = createApp()
        .onSend(() => {
          throw new Error('hook quebrado');
        })
        .mount(H);
      const res = await app.inject('/h/text');
      assert.equal(res.status, 200);
      assert.equal(res.body, 'olá');
      assert.ok(errorLog.mock.calls.some((c) => String(c.arguments[0]).includes('onSend hook failed')));
    } finally {
      errorLog.mock.restore();
    }
  });
});

describe('F-04 · onResponse', () => {
  it('roda depois do envio, com status e duração; erros só são logados', async () => {
    const seen: { path: string; status: number; ms: number }[] = [];
    const errorLog = mock.method(console, 'error', () => {});
    try {
      const app = createApp()
        .onResponse(async (ctx, info) => {
          await new Promise((r) => setTimeout(r, 5));
          seen.push({ path: ctx.path, ...info });
        })
        .onResponse(() => {
          throw new Error('métrica quebrada');
        })
        .mount(H);
      const server = await app.listen(0);
      const { port } = server.address() as { port: number };
      assert.equal((await fetch(`http://127.0.0.1:${port}/h/slow`)).status, 200);
      for (let i = 0; i < 50 && seen.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
      await app.close();
      assert.equal(seen[0]!.path, '/h/slow');
      assert.equal(seen[0]!.status, 200);
      assert.ok(seen[0]!.ms >= 15, `duração ${seen[0]!.ms}ms`);
      assert.ok(errorLog.mock.calls.some((c) => String(c.arguments[0]).includes('onResponse hook failed')));
    } finally {
      errorLog.mock.restore();
    }
  });
});

describe('F-04 · onClose', () => {
  it('roda no close(), em ordem, depois que o servidor fecha', async () => {
    const order: string[] = [];
    const app = createApp({ logger: false, shutdown: false });
    app
      .onClose(() => {
        order.push('db');
      })
      .onClose(async () => {
        order.push('fila');
      });
    const server = await app.listen(0);
    await app.close();
    assert.deepEqual(order, ['db', 'fila']);
    assert.equal(server.listening, false);
  });

  it('roda uma vez por ciclo, inclusive num app que nunca ouviu (testes com inject)', async () => {
    let n = 0;
    const app = createApp({ logger: false }).onClose(() => {
      n++;
    });
    await app.close();
    await app.close();
    assert.equal(n, 1);
  });

  it('um hook com erro não impede os demais, e o close() rejeita ao final', async () => {
    const errorLog = mock.method(console, 'error', () => {});
    const order: string[] = [];
    try {
      const app = createApp({ shutdown: false })
        .onClose(() => {
          throw new Error('falhou');
        })
        .onClose(() => {
          order.push('segundo');
        });
      await app.listen(0);
      await assert.rejects(app.close(), /1 onClose hook\(s\) failed/);
      assert.deepEqual(order, ['segundo']);
    } finally {
      errorLog.mock.restore();
    }
  });

  it('no shutdown por sinal: onClose antes do onShutdown, e erro → saída 1', async () => {
    const exit = mock.method(process, 'exit', (() => undefined) as never);
    const order: string[] = [];
    try {
      const app = createApp({
        logger: false,
        shutdown: {
          onShutdown: () => {
            order.push('onShutdown');
          },
        },
      }).onClose(() => {
        order.push('onClose');
      });
      await app.listen(0);
      process.emit('SIGTERM');
      for (let i = 0; i < 50 && exit.mock.callCount() === 0; i++) await new Promise((r) => setTimeout(r, 10));
      assert.deepEqual(order, ['onClose', 'onShutdown']);
      assert.deepEqual(exit.mock.calls.at(-1)?.arguments, [0]);

      const bad = createApp({ logger: false }).onClose(() => {
        throw new Error('x');
      });
      await bad.listen(0);
      process.emit('SIGTERM');
      for (let i = 0; i < 50 && exit.mock.callCount() < 2; i++) await new Promise((r) => setTimeout(r, 10));
      assert.deepEqual(exit.mock.calls.at(-1)?.arguments, [1]);
    } finally {
      exit.mock.restore();
    }
  });
});

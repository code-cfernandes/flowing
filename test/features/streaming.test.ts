import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, mock } from 'node:test';
import { type Context, createApp, Get, Router, Type } from 'sashiko';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Abre uma requisição e acumula o corpo conforme chega, sem esperar o fim. */
function open(url: string, headers: Record<string, string> = {}) {
  let body = '';
  let res: http.IncomingMessage | undefined;
  const req = http.get(url, { headers }, (r) => {
    res = r;
    r.setEncoding('utf8');
    r.on('data', (c: string) => (body += c));
  });
  req.on('error', () => {});
  const ended = new Promise<void>((resolve) => req.on('close', () => resolve()));
  return {
    get body() {
      return body;
    },
    get res() {
      return res;
    },
    abort: () => req.destroy(),
    ended,
  };
}

const events: { closed: number; aborted: number } = { closed: 0, aborted: 0 };
let push: ((data: unknown) => void) | undefined;

@Router('/')
class Live {
  @Get('/sse') sse(ctx: Context) {
    const stream = ctx.sse({ heartbeatMs: 30, retry: 2000 });
    stream.send({ event: 'hello', id: '1', data: { last: stream.lastEventId ?? null } });
    stream.send('linha 1\nlinha 2');
    push = (data) => stream.send({ data });
    stream.onClose(() => {
      events.closed++;
    });
    ctx.signal.addEventListener('abort', () => {
      events.aborted++;
    });
  }
  @Get('/inject') inject(ctx: Context) {
    const stream = ctx.sse({ heartbeatMs: 0 });
    stream.send({ event: 'ok\ndata: forjado', data: 1 });
  }
  @Get('/ndjson') async *ndjson() {
    for (let i = 1; i <= 3; i++) yield { i };
  }
  @Get('/typed', { response: { 200: { contentType: 'application/x-ndjson', schema: Type.Object({ id: Type.Number() }) } } })
  async *typed() {
    yield { id: 1, password: 'x' };
  }
  @Get('/wrong', { response: { 200: Type.Array(Type.Object({ id: Type.Number() })) } })
  async *wrong() {
    yield { id: 1 };
  }
  @Get('/endless') async *endless(ctx: Context) {
    let i = 0;
    try {
      while (true) {
        yield { i: i++ };
        await tick(5);
      }
    } finally {
      events.closed += ctx.signal.aborted ? 100 : 0;
    }
  }
}

async function listen() {
  const app = createApp({ logger: false, shutdown: false }).mount(Live);
  const server = await app.listen(0);
  return { app, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

describe('ctx.sse()', () => {
  it('headers, retry, eventos com id e multilinha, heartbeat e Last-Event-ID', async () => {
    const { app, url } = await listen();
    try {
      const c = open(`${url}/sse`, { 'last-event-id': '41' });
      await tick(80);
      assert.equal(c.res?.headers['content-type'], 'text/event-stream; charset=utf-8');
      assert.equal(c.res?.headers['cache-control'], 'no-cache, no-transform');
      assert.equal(c.res?.headers['x-accel-buffering'], 'no');
      assert.ok(c.body.startsWith('retry: 2000\n\n'));
      assert.ok(c.body.includes('event: hello\nid: 1\ndata: {"last":"41"}\n\n'));
      assert.ok(c.body.includes('data: linha 1\ndata: linha 2\n\n'));
      assert.ok(c.body.includes(': ping\n\n'), 'heartbeat');
      push?.({ n: 1 });
      await tick(10);
      assert.ok(c.body.includes('data: {"n":1}\n\n'));
      c.abort();
      await tick(20);
    } finally {
      await app.close();
    }
  });

  it('desconexão do cliente cancela ctx.signal e chama onClose', async () => {
    events.closed = 0;
    events.aborted = 0;
    const { app, url } = await listen();
    try {
      const c = open(`${url}/sse`);
      await tick(30);
      c.abort();
      await tick(30);
      assert.equal(events.closed, 1);
      assert.equal(events.aborted, 1);
    } finally {
      await app.close();
    }
  });

  it('o shutdown fecha as conexões SSE na hora, sem esperar o prazo', async () => {
    events.closed = 0;
    const { app, url } = await listen();
    const c = open(`${url}/sse`);
    await tick(30);
    const started = Date.now();
    await app.close(5_000);
    await c.ended;
    assert.ok(Date.now() - started < 1_000, `fechou em ${Date.now() - started}ms`);
    assert.equal(events.closed, 1);
  });

  it('quebra de linha em event/id é recusada (injeção de eventos)', async () => {
    const error = mock.method(console, 'error', () => {});
    try {
      const app = createApp().mount(Live);
      const res = await app.inject('/inject');
      assert.ok(!res.body.includes('forjado'));
    } finally {
      error.mock.restore();
    }
  });
});

describe('async iterable → NDJSON', () => {
  it('uma linha JSON por item', async () => {
    const res = await createApp({ logger: false }).mount(Live).inject('/ndjson');
    assert.equal(res.headers['content-type'], 'application/x-ndjson');
    assert.equal(res.body, '{"i":1}\n{"i":2}\n{"i":3}\n');
  });

  it('com schema por item, os campos não declarados são removidos', async () => {
    const res = await createApp({ logger: false }).mount(Live).inject('/typed');
    assert.equal(res.body, '{"id":1}\n');
  });

  it('rota com schema JSON que retorna um iterable: 500 com orientação no log', async () => {
    const error = mock.method(console, 'error', () => {});
    try {
      const res = await createApp().mount(Live).inject('/wrong');
      assert.equal(res.status, 500);
      assert.match(String((error.mock.calls[0]!.arguments[1] as { err: Error }).err.message), /streamed as NDJSON/);
    } finally {
      error.mock.restore();
    }
  });

  it('cliente que desconecta interrompe o generator (finally roda)', async () => {
    events.closed = 0;
    const { app, url } = await listen();
    try {
      const c = open(`${url}/endless`);
      await tick(40);
      assert.ok(c.body.includes('{"i":0}'));
      c.abort();
      await tick(40);
      assert.ok(events.closed >= 1, 'o finally do generator rodou');
    } finally {
      await app.close();
    }
  });

  it('o shutdown encerra NDJSON infinito sem esperar o prazo', async () => {
    const { app, url } = await listen();
    const c = open(`${url}/endless`);
    await tick(30);
    const started = Date.now();
    await app.close(5_000);
    await c.ended;
    assert.ok(Date.now() - started < 1_000);
  });
});

describe('0.12.1 · bordas do streaming', () => {
  it('ctx.signal acessado depois de uma desconexão já ocorrida nasce cancelado', async () => {
    let aborted: boolean | undefined;
    @Router('/')
    class Late {
      @Get('/late') async late(ctx: Context) {
        await tick(60); // o cliente desconecta durante este await
        aborted = ctx.signal.aborted;
        return 'x';
      }
    }
    const app = createApp({ logger: false, shutdown: false }).mount(Late);
    const server = await app.listen(0);
    try {
      const c = open(`http://127.0.0.1:${(server.address() as AddressInfo).port}/late`);
      await tick(15);
      c.abort();
      await tick(120);
      assert.equal(aborted, true);
    } finally {
      await app.close();
    }
  });

  it('SSE: heartbeatMs e retry precisam ser inteiros não negativos; id sem U+0000; data obrigatório', async () => {
    const outcomes: string[] = [];
    @Router('/')
    class Bad {
      @Get('/s') s(ctx: Context) {
        for (const opts of [{ heartbeatMs: -1 }, { heartbeatMs: 1.5 }, { retry: -100 }]) {
          try {
            ctx.sse(opts);
            outcomes.push('aceito');
          } catch (e) {
            outcomes.push((e as Error).message.includes('non-negative integer') ? 'ok' : 'outro');
          }
        }
        const stream = ctx.sse({ heartbeatMs: 0 });
        for (const ev of [{ retry: -1, data: 'x' }, { id: 'a\0b', data: 'x' }, { data: undefined }]) {
          try {
            stream.send(ev);
            outcomes.push('aceito');
          } catch {
            outcomes.push('ok');
          }
        }
        stream.send({ data: '' });
        stream.close();
      }
    }
    const res = await createApp({ logger: false }).mount(Bad).inject('/s');
    assert.deepEqual(outcomes, ['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    assert.equal(res.body, 'data: \n\n', 'só o evento válido foi escrito');
  });
});

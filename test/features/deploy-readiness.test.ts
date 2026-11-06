import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { describe, it, mock } from 'node:test';
import { consoleLogger, createApp, Get, type Middleware, Router, unauthorized } from 'sashiko';

@Router('/')
class Api {
  @Get('/ping') ping() { return { pong: true }; }
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('app.health()', () => {
  it('/livez e /readyz sem checks respondem 200, sem cache', async () => {
    const app = createApp({ logger: false }).mount(Api).health();
    const live = await app.inject('/livez');
    assert.equal(live.status, 200);
    assert.deepEqual(live.json(), { status: 'ok' });
    assert.equal(live.headers['cache-control'], 'no-store');
    assert.deepEqual((await app.inject('/readyz')).json(), { status: 'ok', checks: {} });
    assert.equal((await app.inject({ method: 'POST', url: '/readyz' })).status, 404);
  });

  it('readyz roda os checks em paralelo; falha, false e timeout dão 503 sem expor o motivo', async () => {
    const warn = mock.fn();
    const log = { debug() {}, info() {}, warn, error() {}, child() { return log; } };
    const app = createApp({ logger: log }).mount(Api).health({
      timeoutMs: 50,
      checks: {
        db: async () => { await tick(5); },
        cache: () => { throw new Error('ECONNREFUSED redis://user:senha@10.0.0.5'); },
        queue: () => false,
        slow: () => tick(500),
      },
    });
    const started = Date.now();
    const res = await app.inject('/readyz');
    assert.ok(Date.now() - started < 400, 'checks em paralelo, limitados pelo timeout');
    assert.equal(res.status, 503);
    assert.deepEqual(res.json(), { status: 'error', checks: { db: 'ok', cache: 'error', queue: 'error', slow: 'timeout' } });
    assert.ok(!res.body.includes('senha'));
    assert.ok(warn.mock.calls.some((c) => (c.arguments[0] as { check?: string }).check === 'cache'));
    assert.equal((await app.inject('/livez')).status, 200, 'liveness não depende dos checks');
  });

  it('rotas próprias, desligadas, e servidas antes dos middlewares globais', async () => {
    const auth: Middleware = (ctx, next) => { if (!ctx.get('authorization')) throw unauthorized(); return next(); };
    const app = createApp({ logger: false }).use(auth).mount(Api).health({ live: '/health', ready: false });
    assert.equal((await app.inject('/health')).status, 200, 'sonda sem credencial passa');
    assert.equal((await app.inject('/readyz')).status, 401, 'readyz desligado cai nas rotas normais');
    assert.equal((await app.inject('/ping')).status, 401);
  });

  it('guards próprios restringem os healthchecks', async () => {
    const app = createApp({ logger: false }).mount(Api).health({ guards: [(ctx) => ctx.get('x-probe') === '1'] });
    assert.equal((await app.inject('/readyz')).status, 403);
    assert.equal((await app.inject({ url: '/readyz', headers: { 'x-probe': '1' } })).status, 200);
  });

  it('live e ready iguais falham na configuração', () => {
    assert.throws(() => createApp().health({ live: '/h', ready: '/h' }), /cannot both be/);
  });
});

describe('shutdown com drain', () => {
  it('no sinal, /readyz vira 503 durante o drainDelayMs, e o servidor ainda atende', async () => {
    const app = createApp({ logger: false, shutdown: { exit: false, drainDelayMs: 150, timeoutMs: 1000 } }).mount(Api).health();
    const server = await app.listen(0);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${url}/readyz`)).status, 200);

    process.emit('SIGTERM');
    await tick(20);
    const during = await fetch(`${url}/readyz`, { headers: { connection: 'close' } });
    assert.equal(during.status, 503);
    assert.deepEqual(await during.json(), { status: 'shutting_down' });
    assert.equal((await fetch(`${url}/livez`, { headers: { connection: 'close' } })).status, 200);
    assert.equal((await fetch(`${url}/ping`, { headers: { connection: 'close' } })).status, 200, 'ainda aceita tráfego no drain');

    await tick(300);
    await assert.rejects(fetch(`${url}/ping`), 'depois do drain, o servidor fechou');
  });

  it('um listen() novo depois do close() volta a ficar pronto', async () => {
    const app = createApp({ logger: false, shutdown: false }).mount(Api).health();
    await app.listen(0);
    await app.close();
    const server = await app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/readyz`);
      assert.equal(res.status, 200);
    } finally {
      await app.close();
    }
  });
});

describe("consoleLogger({ format: 'json' })", () => {
  it('uma linha JSON por evento, com level, time, msg, bindings e redact', () => {
    const info = mock.method(console, 'info', () => {});
    try {
      consoleLogger({ format: 'json' }).child({ reqId: 'r1' }).info({ userId: 7, password: 'p', n: 10n }, 'user created');
      const line = info.mock.calls[0]!.arguments[0] as string;
      assert.equal(info.mock.calls[0]!.arguments.length, 1);
      const record = JSON.parse(line);
      assert.equal(record.level, 'info');
      assert.equal(record.msg, 'user created');
      assert.match(record.time, /^\d{4}-\d{2}-\d{2}T/);
      assert.deepEqual({ reqId: record.reqId, userId: record.userId, password: record.password, n: record.n }, {
        reqId: 'r1', userId: 7, password: '[REDACTED]', n: '10',
      });
    } finally { info.mock.restore(); }
  });

  it('erros com stack e propriedades, ciclos sem quebrar, mesmo com redact: false', () => {
    const error = mock.method(console, 'error', () => {});
    try {
      const err = Object.assign(new Error('boom'), { code: 'E_DB' });
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      consoleLogger({ format: 'json', redact: false }).error({ err, cyclic }, 'failed');
      const record = JSON.parse(error.mock.calls[0]!.arguments[0] as string);
      assert.equal(record.err.type, 'Error');
      assert.equal(record.err.message, 'boom');
      assert.equal(record.err.code, 'E_DB');
      assert.match(record.err.stack, /boom/);
      assert.deepEqual(record.cyclic, { self: '[Circular]' });
    } finally { error.mock.restore(); }
  });
});

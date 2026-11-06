import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { type Context, consoleLogger, Controller, createApp, Get, type Logger } from 'picodecor';

/** Logger em memória que registra as chamadas, no formato do pino. */
function memoryLogger(bindings: Record<string, unknown> = {}, lines: Record<string, unknown>[] = []): Logger & { lines: typeof lines } {
  const emit = (level: string) => (objOrMsg: object | string, msg?: string) => {
    const [data, text] = typeof objOrMsg === 'string' ? [{}, objOrMsg] : [objOrMsg, msg];
    lines.push({ level, msg: text, ...bindings, ...data });
  };
  return {
    lines,
    debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error'),
    child: (extra) => memoryLogger({ ...bindings, ...extra }, lines),
  };
}

@Controller('/log')
class L {
  @Get('/') hello(ctx: Context) { ctx.log.info({ custom: true }, 'inside handler'); return { id: ctx.id }; }
  @Get('/boom') boom() { throw new Error('kaboom'); }
}

describe('F-06 · request id', () => {
  const app = createApp({ logger: false }).controllers([L]);

  it('gera um id, expõe em ctx.id e devolve no header X-Request-Id', async () => {
    const res = await app.inject('/log');
    const id = res.headers['x-request-id'] as string;
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(res.json(), { id });
  });

  it('reaproveita um id recebido válido', async () => {
    const res = await app.inject({ url: '/log', headers: { 'x-request-id': 'gw-123.abc' } });
    assert.equal(res.headers['x-request-id'], 'gw-123.abc');
  });

  it('descarta id recebido inválido (evita log injection)', async () => {
    const res = await app.inject({ url: '/log', headers: { 'x-request-id': 'x\u0000evil {"admin":true}' } });
    assert.notEqual(res.headers['x-request-id'], 'x\u0000evil {"admin":true}');
  });

  it('trustIncoming: false sempre gera um novo id; header e gerador configuráveis', async () => {
    let n = 0;
    const custom = createApp({
      logger: false,
      requestId: { header: 'x-correlation-id', trustIncoming: false, generate: () => `req-${++n}` },
    }).controllers([L]);
    const res = await custom.inject({ url: '/log', headers: { 'x-correlation-id': 'from-client' } });
    assert.equal(res.headers['x-correlation-id'], 'req-1');
    assert.equal(res.headers['x-request-id'], undefined);
  });
});

describe('F-06 · logger plugável', () => {
  it('ctx.log é filho do logger do app com reqId', async () => {
    const logger = memoryLogger();
    const app = createApp({ logger }).controllers([L]);
    const res = await app.inject('/log');
    const line = logger.lines.find((l) => l.msg === 'inside handler')!;
    assert.equal(line.reqId, res.headers['x-request-id']);
    assert.equal(line.custom, true);
  });

  it('erros não expostos vão para o logger com err, status e reqId', async () => {
    const logger = memoryLogger();
    const app = createApp({ logger }).controllers([L]);
    const res = await app.inject('/log/boom');
    const line = logger.lines.find((l) => l.level === 'error')!;
    assert.equal((line.err as Error).message, 'kaboom');
    assert.equal(line.status, 500);
    assert.equal(line.reqId, res.headers['x-request-id']);
  });

  it('logRequests registra método, path, status e duração ao concluir', async () => {
    const logger = memoryLogger();
    const app = createApp({ logger, logRequests: true }).controllers([L]);
    const srvApp = await app.listen(0);
    try {
      const { port } = srvApp.address() as { port: number };
      await (await fetch(`http://127.0.0.1:${port}/log`)).text();
      await new Promise((r) => setImmediate(r));
      const line = logger.lines.find((l) => l.msg === 'request completed')!;
      assert.equal(line.method, 'GET');
      assert.equal(line.path, '/log');
      assert.equal(line.status, 200);
      assert.equal(typeof line.ms, 'number');
    } finally {
      await app.close();
    }
  });

  it('logger: false não escreve nada', async () => {
    const errorLog = mock.method(console, 'error', () => {});
    try {
      await createApp({ logger: false }).controllers([L]).inject('/log/boom');
      assert.equal(errorLog.mock.callCount(), 0);
    } finally { errorLog.mock.restore(); }
  });

  it('consoleLogger respeita o nível mínimo e mescla os bindings do child', () => {
    const info = mock.method(console, 'info', () => {});
    const debug = mock.method(console, 'debug', () => {});
    try {
      const log = consoleLogger({ level: 'info' }).child({ svc: 'api' });
      log.debug('escondido');
      log.info({ a: 1 }, 'visível');
      assert.equal(debug.mock.callCount(), 0);
      assert.deepEqual(info.mock.calls[0]!.arguments, ['[picodecor] visível', { svc: 'api', a: 1 }]);
    } finally { info.mock.restore(); debug.mock.restore(); }
  });
});

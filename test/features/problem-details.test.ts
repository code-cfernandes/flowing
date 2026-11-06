import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createApp, Get, HttpError, Post, Router } from 'sashiko';

@Router('/p')
class P {
  @Get('/typed') typed() {
    throw new HttpError(409, 'Saldo insuficiente', 'NO_FUNDS', { type: 'https://exemplo.dev/problems/no-funds', details: { balance: 3 } });
  }
  @Get('/boom') boom() {
    throw new Error('segredo interno');
  }
  @Post('/only-post') onlyPost() {
    return { ok: true };
  }
}

describe('F-15 · Problem Details (RFC 9457)', () => {
  const app = createApp({ logger: false }).mount(P);

  it('erros saem como application/problem+json', async () => {
    const res = await app.inject('/p/typed');
    assert.equal(res.status, 409);
    assert.equal(res.headers['content-type'], 'application/problem+json; charset=utf-8');
    assert.deepEqual(res.json(), {
      type: 'https://exemplo.dev/problems/no-funds',
      title: 'Conflict',
      status: 409,
      detail: 'Saldo insuficiente',
      code: 'NO_FUNDS',
      details: { balance: 3 },
    });
  });

  it('500 não expõe detail nem a mensagem original', async () => {
    const res = await app.inject('/p/boom');
    assert.equal(res.headers['content-type'], 'application/problem+json; charset=utf-8');
    assert.deepEqual(res.json(), { type: 'about:blank', title: 'Internal Server Error', status: 500 });
  });

  it('405 traz os métodos permitidos em details', async () => {
    const res = await app.inject('/p/only-post');
    assert.equal(res.status, 405);
    assert.equal(res.headers.allow, 'OPTIONS, POST');
    assert.deepEqual(res.json(), {
      type: 'about:blank',
      title: 'Method Not Allowed',
      status: 405,
      code: 'METHOD_NOT_ALLOWED',
      details: { allowed: ['OPTIONS', 'POST'] },
    });
  });
});

describe('F-15 · formatError', () => {
  it('personaliza o corpo de todos os erros, inclusive 404 e Host inválido', async () => {
    const app = createApp({
      logger: false,
      formatError: (problem, ctx) => ({ error: problem.detail ?? problem.title, code: problem.code, requestId: ctx.id }),
    }).mount(P);

    const typed = await app.inject({ url: '/p/typed', headers: { 'x-request-id': 'abc' } });
    assert.equal(typed.status, 409);
    assert.equal(typed.headers['content-type'], 'application/json; charset=utf-8');
    assert.deepEqual(typed.json(), { error: 'Saldo insuficiente', code: 'NO_FUNDS', requestId: 'abc' });

    const missing = await app.inject({ url: '/nada', headers: { 'x-request-id': 'def' } });
    assert.deepEqual(missing.json(), { error: 'Not Found', code: 'NOT_FOUND', requestId: 'def' });

    const host = await app.inject({ url: '/p/typed', headers: { host: 'a b', 'x-request-id': 'ghi' } });
    assert.equal(host.status, 400);
    assert.deepEqual(host.json(), { error: 'Invalid Host header', code: 'INVALID_HOST', requestId: 'ghi' });
  });

  it('se o formatError lançar, loga e envia o problema padrão', async () => {
    const errorLog = mock.method(console, 'error', () => {});
    try {
      const app = createApp({
        formatError: () => {
          throw new Error('bug no formatter');
        },
      }).mount(P);
      const res = await app.inject('/p/typed');
      assert.equal(res.status, 409);
      assert.equal(res.headers['content-type'], 'application/problem+json; charset=utf-8');
      assert.equal(res.json<{ code: string }>().code, 'NO_FUNDS');
      assert.ok(errorLog.mock.calls.some((c) => String(c.arguments[0]).includes('formatError failed')));
    } finally {
      errorLog.mock.restore();
    }
  });
});

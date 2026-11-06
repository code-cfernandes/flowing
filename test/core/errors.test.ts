import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';
import { type Context, Router, createApp, Get, HttpError, internal, notFound, Post } from 'sashiko';
import { startServer, type TestServer } from '../helpers/server.ts';

@Router('/t')
class ErrorsController {
  @Get('/throw-418')
  ctxThrow(ctx: Context) {
    ctx.throw(418, "I'm a teapot");
  }

  @Get('/not-found')
  notFound() {
    throw notFound('user not found');
  }

  @Get('/plain-error')
  plainError() {
    throw new Error('SELECT * FROM users WHERE password = ...');
  }

  @Get('/internal')
  internal() {
    throw internal('db connection string: postgres://admin:secret@db');
  }

  @Get('/http-500-exposed')
  exposed500() {
    throw new HttpError(503, 'Maintenance window', 'MAINTENANCE', { expose: true });
  }

  @Get('/non-error')
  nonError() {
    throw 'a string';
  }

  @Post('/echo')
  echo(ctx: Context) {
    return ctx.body;
  }
}

describe('tratamento de erros', () => {
  let srv: TestServer;
  const errorLog = mock.method(console, 'error', () => {});

  before(async () => {
    const app = createApp({ bodyLimit: 1024 }).mount(ErrorsController);
    srv = await startServer(app);
  });
  after(async () => {
    errorLog.mock.restore();
    await srv.close();
  });

  const get = (path: string) => fetch(srv.url + path);
  const postJson = (path: string, body: string) =>
    fetch(srv.url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

  describe('B-01 · ctx.throw() respeita o status', () => {
    it('ctx.throw(418) responde 418 com a mensagem', async () => {
      const res = await get('/t/throw-418');
      assert.equal(res.status, 418);
      assert.deepEqual(await res.json(), { type: 'about:blank', title: "I'm a Teapot", status: 418, detail: "I'm a teapot" });
    });

    it('JSON malformado responde 400', async () => {
      const res = await postJson('/t/echo', '{oops');
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), {
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'Invalid JSON',
        code: 'INVALID_JSON',
      });
    });

    it('payload acima do bodyLimit responde 413', async () => {
      const res = await postJson('/t/echo', JSON.stringify({ a: 'x'.repeat(2048) }));
      assert.equal(res.status, 413);
      assert.deepEqual(await res.json(), {
        type: 'about:blank',
        title: 'Payload Too Large',
        status: 413,
        detail: 'Payload too large',
        code: 'PAYLOAD_TOO_LARGE',
      });
    });
  });

  describe('S-05 · não vazar detalhes de erros 5xx', () => {
    it('HttpError 4xx expõe a mensagem', async () => {
      const res = await get('/t/not-found');
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), {
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: 'user not found',
        code: 'NOT_FOUND',
      });
    });

    it('Error comum vira 500 genérico', async () => {
      const res = await get('/t/plain-error');
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { type: 'about:blank', title: 'Internal Server Error', status: 500 });
    });

    it('HttpError 5xx não expõe a mensagem por padrão', async () => {
      const res = await get('/t/internal');
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { type: 'about:blank', title: 'Internal Server Error', status: 500 });
    });

    it('HttpError 5xx com expose: true mostra a mensagem', async () => {
      const res = await get('/t/http-500-exposed');
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), {
        type: 'about:blank',
        title: 'Service Unavailable',
        status: 503,
        detail: 'Maintenance window',
        code: 'MAINTENANCE',
      });
    });

    it('valor lançado que não é Error vira 500 genérico', async () => {
      const res = await get('/t/non-error');
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { type: 'about:blank', title: 'Internal Server Error', status: 500 });
    });

    it('erros não expostos são logados no servidor com o erro original', async () => {
      errorLog.mock.resetCalls();
      await get('/t/plain-error');
      assert.equal(errorLog.mock.callCount(), 1);
      const data = errorLog.mock.calls[0]!.arguments[1] as { err: Error; status: number; reqId: string };
      assert.match(data.err.message, /SELECT \* FROM users/);
      assert.equal(data.status, 500);
      assert.ok(data.reqId, 'o log traz o request id');
    });
  });
});

describe('HttpError', () => {
  it('guarda cause e details; isHttpError identifica', async () => {
    const { isHttpError } = await import('sashiko');
    const root = new Error('raiz');
    const err = new HttpError(422, 'inválido', 'UNPROCESSABLE', { cause: root, details: [{ path: '/x' }] });
    assert.equal(err.cause, root);
    assert.deepEqual(err.details, [{ path: '/x' }]);
    assert.equal(err.expose, true);
    assert.equal(isHttpError(err), true);
    assert.equal(isHttpError(new Error('x')), false);
  });
});

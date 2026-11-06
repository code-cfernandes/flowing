import { Type } from '@sinclair/typebox';
import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';
import { type Context, Router, createApp, Get, Post, Schema } from 'sashiko';
import { startServer, type TestServer } from '../helpers/server.ts';

const postJson = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('B-08 · exceção em onError não derruba o processo', () => {
  let srv: TestServer;
  const errorLog = mock.method(console, 'error', () => {});
  const rejections: unknown[] = [];
  const onRejection = (r: unknown) => rejections.push(r);

  @Router('/b08')
  class C {
    @Get('/') boom() { throw new Error('original'); }
  }

  before(async () => {
    process.on('unhandledRejection', onRejection);
    const app = createApp()
      .onError(() => { throw new Error('handler quebrado'); })
      .mount(C);
    srv = await startServer(app);
  });
  after(async () => {
    process.off('unhandledRejection', onRejection);
    errorLog.mock.restore();
    await srv.close();
  });

  it('responde 500 genérico e não gera unhandledRejection', async () => {
    const res = await fetch(srv.url + '/b08');
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { type: 'about:blank', title: 'Internal Server Error', status: 500 });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(rejections, []);
  });

  it('o servidor continua atendendo depois da falha', async () => {
    assert.equal((await fetch(srv.url + '/b08')).status, 500);
  });
});

describe('B-09 · herança de controllers', () => {
  @Router('/base')
  class Base {
    @Get('/hello') hello() { return { from: 'base' }; }
  }

  @Router('/child')
  class Child extends Base {
    @Get('/extra') extra() { return { from: 'child' }; }
    override hello() { return { from: 'child-override' }; }
  }

  let srv: TestServer;
  before(async () => { srv = await startServer(createApp().mount(Base).mount(Child)); });
  after(() => srv.close());

  const get = async (p: string) => {
    const r = await fetch(srv.url + p);
    return { status: r.status, body: r.status === 200 ? await r.json() : undefined };
  };

  it('a classe base mantém só as próprias rotas e o próprio prefixo', async () => {
    assert.deepEqual(await get('/base/hello'), { status: 200, body: { from: 'base' } });
    assert.equal((await get('/base/extra')).status, 404);
  });

  it('a subclasse herda rotas do pai com o próprio prefixo e respeita overrides', async () => {
    assert.deepEqual(await get('/child/extra'), { status: 200, body: { from: 'child' } });
    assert.deepEqual(await get('/child/hello'), { status: 200, body: { from: 'child-override' } });
  });
});

describe('B-02 / B-03 / B-06 · validação', () => {
  @Router('/v')
  class V {
    @Post('/body')
    @Schema({ body: Type.Object({ name: Type.String({ minLength: 1 }), age: Type.Integer() }) })
    body(ctx: Context) { return ctx.body; }

    @Get('/query')
    @Schema({ query: Type.Object({ page: Type.Integer({ minimum: 1 }) }) })
    query(ctx: Context) { return ctx.query; }

    @Get('/headers')
    @Schema({ headers: Type.Object({ 'x-api-key': Type.String({ minLength: 8 }) }) })
    headers(ctx: Context) { return { ok: true, host: typeof ctx.req.headers.host }; }
  }

  let srv: TestServer;
  before(async () => { srv = await startServer(createApp().mount(V)); });
  after(() => srv.close());

  it('B-02 · 400 traz a parte inválida e os detalhes de cada erro', async () => {
    const res = await postJson(srv.url + '/v/body', { name: '', age: 'x' });
    assert.equal(res.status, 400);
    const json = await res.json() as { detail: string; details: { path: string; message: string }[] };
    assert.equal(json.detail, 'Invalid body');
    const paths = json.details.map((d) => d.path).sort();
    assert.deepEqual(paths, ['/age', '/name']);
    for (const d of json.details) assert.equal(typeof d.message, 'string');
  });

  it('B-06 · body não sofre coerção de tipos', async () => {
    const res = await postJson(srv.url + '/v/body', { name: 'Ana', age: '30' });
    assert.equal(res.status, 400);
  });

  it('B-06 · body válido passa sem alterações', async () => {
    const res = await postJson(srv.url + '/v/body', { name: 'Ana', age: 30, extra: true });
    assert.deepEqual(await res.json(), { name: 'Ana', age: 30, extra: true });
  });

  it('B-06 · query continua com coerção (string → integer)', async () => {
    const res = await fetch(srv.url + '/v/query?page=2');
    assert.deepEqual(await res.json(), { page: 2 });
  });

  it('B-03 · header obrigatório ausente responde 400', async () => {
    const res = await fetch(srv.url + '/v/headers');
    assert.equal(res.status, 400);
    assert.equal((await res.json() as { detail: string }).detail, 'Invalid headers');
  });

  it('B-03 · header válido passa e os demais headers ficam intactos', async () => {
    const res = await fetch(srv.url + '/v/headers', { headers: { 'X-Api-Key': '12345678' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, host: 'string' });
  });
});

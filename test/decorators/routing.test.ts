import { Type } from '@sinclair/typebox';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { type Context, Router, createApp, Delete, Get, Patch, Post, Put, Schema } from 'flowingts';
import { startServer, type TestServer } from '../helpers/server.ts';

const Item = Type.Object({ id: Type.String(), name: Type.String() });

@Router('/items')
class ItemController {
  @Get('/')
  list() {
    return [{ id: '1', name: 'a' }];
  }

  @Get('/:id')
  @Schema({ params: Type.Object({ id: Type.String({ pattern: '^[0-9]+$' }) }), response: { 200: Item } })
  one(ctx: Context) {
    return { id: ctx.params.id, name: 'a', secret: 'não deve sair' };
  }

  @Post('/')
  @Schema({ body: Type.Object({ name: Type.String({ minLength: 1 }) }), response: { 201: Item } })
  create(ctx: Context) {
    ctx.status(201);
    return { id: '2', ...(ctx.body as { name: string }) };
  }

  @Put('/:id') put() {
    return { method: 'PUT' };
  }
  @Patch('/:id') patch() {
    return { method: 'PATCH' };
  }
  @Delete('/:id') remove(ctx: Context) {
    ctx.status(204);
  }

  @Get('/search/q')
  @Schema({ query: Type.Object({ limit: Type.Integer({ minimum: 1 }) }) })
  search(ctx: Context) {
    return { limit: ctx.query.limit };
  }

  @Get('/async/ok')
  async slow() {
    await new Promise((r) => setTimeout(r, 5));
    return { ok: true };
  }
}

describe('roteamento e decorators', () => {
  let srv: TestServer;
  before(async () => {
    srv = await startServer(createApp().mount(ItemController));
  });
  after(() => srv.close());

  const req = (method: string, path: string, body?: unknown) =>
    fetch(srv.url + path, {
      method,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });

  it('@Controller + @Get registram a rota com prefixo', async () => {
    const res = await req('GET', '/items');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{ id: '1', name: 'a' }]);
  });

  it('todos os verbos HTTP funcionam', async () => {
    assert.deepEqual(await (await req('PUT', '/items/1')).json(), { method: 'PUT' });
    assert.deepEqual(await (await req('PATCH', '/items/1')).json(), { method: 'PATCH' });
    const del = await req('DELETE', '/items/1');
    assert.equal(del.status, 204);
  });

  it('handlers async são aguardados', async () => {
    assert.deepEqual(await (await req('GET', '/items/async/ok')).json(), { ok: true });
  });

  it('schema de resposta remove campos não declarados', async () => {
    const res = await req('GET', '/items/42');
    assert.deepEqual(await res.json(), { id: '42', name: 'a' });
  });

  it('params inválidos respondem 400', async () => {
    assert.equal((await req('GET', '/items/abc')).status, 400);
  });

  it('body válido com status customizado', async () => {
    const res = await req('POST', '/items', { name: 'novo' });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { id: '2', name: 'novo' });
  });

  it('body inválido responde 400', async () => {
    assert.equal((await req('POST', '/items', { name: '' })).status, 400);
  });

  it('query é coagida e validada', async () => {
    assert.deepEqual(await (await req('GET', '/items/search/q?limit=5')).json(), { limit: 5 });
    assert.equal((await req('GET', '/items/search/q?limit=0')).status, 400);
  });

  it('rota inexistente responde 404', async () => {
    assert.equal((await req('GET', '/nada')).status, 404);
  });

  it('método não suportado responde 405 com Allow', async () => {
    const res = await req('DELETE', '/items');
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET, HEAD, OPTIONS, POST');
  });

  it('classe sem @Controller gera erro claro', () => {
    class Plain {}
    assert.throws(() => createApp().mount(Plain), /not decorated with @Router/);
  });
});

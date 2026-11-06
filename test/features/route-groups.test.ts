import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Context, createApp, Get, Guards, type Middleware, Middlewares, Router, Type } from 'sashiko';

const trace =
  (name: string): Middleware =>
  async (ctx, next) => {
    ((ctx.state.trace as string[] | undefined) ?? (ctx.state.trace = [])).push(name);
    await next();
  };
const allow = (header: string) => (ctx: Context) => ctx.get(header) === 'yes';

@Router('/users')
@Middlewares(trace('class'))
class Users {
  @Get('/') @Middlewares(trace('method')) list(ctx: Context) {
    return { trace: ctx.state.trace ?? [] };
  }
  @Get('/:id') get(ctx: Context) {
    return { id: ctx.params.id, trace: ctx.state.trace ?? [] };
  }
}

@Router('/orders')
class Orders {
  @Get('/') list(ctx: Context) {
    return { trace: ctx.state.trace ?? [] };
  }
}

@Router('/health')
class Health {
  @Get('/') check(ctx: Context) {
    return { trace: ctx.state.trace ?? [] };
  }
}

describe('app.group()', () => {
  it('prefixo e middlewares comuns a vários mounts, na ordem grupo → mount → classe → método', async () => {
    const app = createApp({ logger: false })
      .group({ prefix: '/v2', middlewares: [trace('group')] }, (g) => g.mount(Users, { middlewares: [trace('mount')] }).mount(Orders))
      .mount(Health);

    assert.deepEqual((await app.inject('/v2/users')).json(), { trace: ['group', 'mount', 'class', 'method'] });
    assert.deepEqual((await app.inject('/v2/orders')).json(), { trace: ['group'] });
    assert.equal((await app.inject('/users')).status, 404);
    assert.deepEqual((await app.inject('/health')).json(), { trace: [] }, 'fora do grupo, nada muda');
  });

  it('grupos aninhados somam prefixos e acumulam middlewares e guards de fora para dentro', async () => {
    const app = createApp({ logger: false }).group({ prefix: '/api', middlewares: [trace('outer')], guards: [allow('x-a')] }, (g) =>
      g.group({ prefix: '/admin', middlewares: [trace('inner')], guards: [allow('x-b')] }, (admin) => admin.mount(Orders)),
    );
    const both = { 'x-a': 'yes', 'x-b': 'yes' };
    assert.deepEqual((await app.inject({ url: '/api/admin/orders', headers: both })).json(), { trace: ['outer', 'inner'] });
    assert.equal((await app.inject({ url: '/api/admin/orders', headers: { 'x-a': 'yes' } })).status, 403);
    assert.equal((await app.inject({ url: '/api/admin/orders', headers: { 'x-b': 'yes' } })).status, 403);
  });

  it('guards do grupo rodam antes dos guards do mount e da classe', async () => {
    const order: string[] = [];
    const g = (name: string) => () => {
      order.push(name);
      return true;
    };
    @Router('/x')
    @Guards(g('class'))
    class X {
      @Get('/') x() {
        return 'ok';
      }
    }
    const app = createApp({ logger: false }).group({ guards: [g('group')] }, (grp) => grp.mount(X, { guards: [g('mount')] }));
    assert.equal((await app.inject('/x')).status, 200);
    assert.deepEqual(order, ['group', 'mount', 'class']);
  });

  it('mapeamento manual e mount encadeado continuam dentro do grupo', async () => {
    const app = createApp({ logger: false }).group({ prefix: '/v2', middlewares: [trace('group')] }, (g) =>
      g
        .mount(Users)
        .get('/legacy/:id', (r) => r.get)
        .mount(Orders),
    );
    assert.deepEqual((await app.inject('/v2/users/legacy/7')).json(), { id: '7', trace: ['group', 'class'] });
    assert.equal((await app.inject('/v2/orders')).status, 200);
  });

  it('group() a partir do retorno de mount(), e mount() com prefixo próprio dentro do grupo', async () => {
    const app = createApp({ logger: false })
      .mount(Health)
      .group({ prefix: '/v3' }, (g) => g.mount(Orders, { prefix: '/pedidos' }));
    assert.equal((await app.inject('/v3/pedidos')).status, 200);
    assert.equal((await app.inject('/health')).status, 200);
  });

  it('o grupo pode ter parâmetros no prefixo, conferidos contra o schema de params', async () => {
    @Router('/users')
    class Scoped {
      @Get('/:id', { params: Type.Object({ org: Type.String(), id: Type.String() }) })
      get(ctx: Context) {
        return ctx.params;
      }
    }
    const app = createApp({ logger: false }).group({ prefix: '/orgs/:org' }, (g) => g.mount(Scoped));
    assert.deepEqual((await app.inject('/orgs/acme/users/1')).json(), { org: 'acme', id: '1' });
    assert.throws(() => createApp().group({}, (g) => g.mount(Scoped)), /not in path: "org"/);
  });

  it('o grupo aparece no OpenAPI com o prefixo completo', () => {
    const doc = createApp({ logger: false })
      .group({ prefix: '/v2' }, (g) => g.mount(Orders))
      .openapiDocument() as {
      paths: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(doc.paths), ['/v2/orders']);
  });

  it('callback assíncrono é recusado', () => {
    assert.throws(
      () =>
        createApp().group({}, async (g) => {
          g.mount(Orders);
        }),
      /must be synchronous/,
    );
  });
});

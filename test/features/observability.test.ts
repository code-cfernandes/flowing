import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type Context, createApp, Get, type RouteInfo, Router } from 'sashiko';

@Router('/users')
class UserRoutes {
  @Get('/:id') getUser(ctx: Context) {
    return { route: ctx.route };
  }
}

/** Lê o `route` devolvido pelo handler de teste. */
const routeOf = (res: { json(): unknown }) => (res.json() as { route: RouteInfo }).route;

/** Middleware global que lê o `ctx.route` depois do `next()` (modelo onion), inclusive em 404. */
function capture(seen: (RouteInfo | undefined)[]) {
  return async (ctx: Context, next: () => Promise<void>) => {
    await next();
    seen.push(ctx.route);
  };
}

describe('F-38 · ctx.route', () => {
  it('traz o template com o prefixo, a classe e o método, nunca o path recebido', async () => {
    const app = createApp({ logger: false, shutdown: false });
    app.group({ prefix: '/v1' }, (g) => g.mount(UserRoutes));
    const res = await app.inject('/v1/users/42');
    assert.deepEqual(routeOf(res), { method: 'GET', path: '/v1/users/:id', owner: 'UserRoutes', handler: 'getUser' });
  });

  it('a mesma classe montada duas vezes tem o template de cada montagem', async () => {
    const app = createApp({ logger: false, shutdown: false });
    app.group({ prefix: '/v1' }, (g) => g.mount(UserRoutes));
    app.mount(UserRoutes, { prefix: '/clientes' });
    assert.equal(routeOf(await app.inject('/clientes/1')).path, '/clientes/:id');
    assert.equal(routeOf(await app.inject('/v1/users/1')).path, '/v1/users/:id');
  });

  it('host: traz a regra que venceu, não o hostname do cliente', async () => {
    const app = createApp({ logger: false, shutdown: false });
    app.group({ host: ['*.exemplo.com', 'admin.test'] }, (g) => g.mount(UserRoutes));
    app.mount(UserRoutes, { prefix: '/any' });

    const tenant = await app.inject({ url: '/users/1', headers: { host: 'acme.exemplo.com' } });
    assert.equal(routeOf(tenant).host, '*.exemplo.com');
    const admin = await app.inject({ url: '/users/1', headers: { host: 'admin.test' } });
    assert.equal(routeOf(admin).host, 'admin.test');
    const anyHost = await app.inject({ url: '/any/1', headers: { host: 'outro.dev' } });
    assert.equal('host' in routeOf(anyHost), false);
  });

  it('undefined em 404 e 405; estáticos e rotas manuais também são identificados', async () => {
    const seen: (RouteInfo | undefined)[] = [];
    const app = createApp({ logger: false, shutdown: false });
    app.use(capture(seen));
    app.mount(UserRoutes).get('/perfil/:id', (r) => r.getUser);
    app.static('/assets', fileURLToPath(new URL('../fixtures', import.meta.url)));
    await app.inject('/nada');
    await app.inject({ method: 'DELETE', url: '/users/1' });
    await app.inject('/users/perfil/7');
    assert.equal((await app.inject('/assets/tls/README.md')).status, 200);
    assert.equal(seen[0], undefined, '404');
    assert.equal(seen[1], undefined, '405');
    assert.deepEqual(seen[2], { method: 'GET', path: '/users/perfil/:id', owner: 'UserRoutes', handler: 'getUser' });
    assert.equal(seen[3]?.path, '/assets/*');
    assert.equal(seen[3]?.owner, 'static');
  });

  it('é imutável: uma requisição não altera o que a próxima vê', async () => {
    @Router('/x')
    class X {
      @Get('/') x(ctx: Context) {
        assert.throws(() => {
          (ctx.route as { path: string }).path = '/hack';
        }, TypeError);
        return { path: ctx.route?.path };
      }
    }
    const app = createApp({ logger: false, shutdown: false });
    app.mount(X);
    // `@Get('/')` em `@Router('/x')` é registrada como `/x/`: o template é o registrado.
    assert.equal(((await app.inject('/x')).json() as { path: string }).path, '/x/');
    assert.equal(((await app.inject('/x')).json() as { path: string }).path, '/x/');
  });
});

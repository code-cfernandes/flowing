import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { type Context, createApp, Get, Post, Router } from 'flowingts';
import { compileRouteHost } from '../../src/utils/origin-match.ts';

@Router('/users')
class ApiUsers {
  @Get('/') list() {
    return { from: 'api' };
  }
}

@Router('/users')
class AdminUsers {
  @Get('/') list() {
    return { from: 'admin' };
  }
  @Post('/') create() {
    return { created: true };
  }
}

@Router('/reports')
class Reports {
  @Get('/') list() {
    return { from: 'reports' };
  }
}

@Router('/')
class Tenant {
  @Get('/whoami') who(ctx: Context) {
    return { tenant: ctx.hostname.split('.')[0] };
  }
}

@Router('/health')
class Health {
  @Get('/') ok() {
    return { ok: true };
  }
}

const at = (host: string) => ({ headers: { host } });

describe('F-35 · virtual hosts', () => {
  const app = createApp({ logger: false })
    .group({ host: 'admin.exemplo.com' }, (g) => g.mount(AdminUsers).mount(Reports))
    .mount(ApiUsers, { host: ['api.exemplo.com', 'API.exemplo.dev'] })
    .mount(Tenant, { host: '*.clientes.exemplo.com' })
    .mount(Health);

  it('o mesmo path responde rotas diferentes por host; a porta é ignorada', async () => {
    assert.deepEqual((await app.inject({ url: '/users', ...at('api.exemplo.com') })).json(), { from: 'api' });
    assert.deepEqual((await app.inject({ url: '/users', ...at('api.exemplo.dev:8443') })).json(), { from: 'api' });
    assert.deepEqual((await app.inject({ url: '/users', ...at('ADMIN.exemplo.com') })).json(), { from: 'admin' });
  });

  it('rotas de um host não vazam para outro: 404, e 405 calculado por host', async () => {
    assert.equal((await app.inject({ url: '/reports', ...at('api.exemplo.com') })).status, 404);
    assert.equal((await app.inject({ url: '/users', ...at('outro.com') })).status, 404);
    const post = await app.inject({ method: 'POST', url: '/users', ...at('api.exemplo.com') });
    assert.equal(post.status, 405, 'POST /users só existe no admin');
    assert.equal(post.headers.allow, 'GET, HEAD, OPTIONS');
    assert.equal((await app.inject({ method: 'POST', url: '/users', ...at('admin.exemplo.com') })).status, 200);
  });

  it('curinga aceita subdomínios de qualquer profundidade, nunca o domínio em si', async () => {
    assert.deepEqual((await app.inject({ url: '/whoami', ...at('acme.clientes.exemplo.com') })).json(), { tenant: 'acme' });
    assert.equal((await app.inject({ url: '/whoami', ...at('a.b.clientes.exemplo.com') })).status, 200);
    assert.equal((await app.inject({ url: '/whoami', ...at('clientes.exemplo.com') })).status, 404);
    assert.equal((await app.inject({ url: '/whoami', ...at('x.clientes.exemplo.com.atacante.dev') })).status, 404);
  });

  it('rota sem host vale para todos os hosts', async () => {
    for (const host of ['api.exemplo.com', 'admin.exemplo.com', 'qualquer.dev']) {
      assert.equal((await app.inject({ url: '/health', ...at(host) })).status, 200, host);
    }
  });

  it('host exato tem prioridade sobre curinga e sobre a rota sem host', async () => {
    @Router('/')
    class Any {
      @Get('/x') x() {
        return 'any';
      }
    }
    @Router('/')
    class Wild {
      @Get('/x') x() {
        return 'wild';
      }
    }
    @Router('/')
    class Exact {
      @Get('/x') x() {
        return 'exact';
      }
    }
    const p = createApp({ logger: false }).mount(Any).mount(Wild, { host: '*.exemplo.com' }).mount(Exact, { host: 'vip.exemplo.com' });
    assert.equal((await p.inject({ url: '/x', ...at('vip.exemplo.com') })).body, 'exact');
    assert.equal((await p.inject({ url: '/x', ...at('a.exemplo.com') })).body, 'wild');
    assert.equal((await p.inject({ url: '/x', ...at('outro.dev') })).body, 'any');
  });

  it('com trustProxy, usa o X-Forwarded-Host confiável', async () => {
    const p = createApp({ logger: false, trustProxy: 1 }).mount(ApiUsers, { host: 'api.exemplo.com' });
    const res = await p.inject({ url: '/users', headers: { host: 'interno:3000', 'x-forwarded-host': 'api.exemplo.com' } });
    assert.deepEqual(res.json(), { from: 'api' });
  });

  it('RegExp precisa casar o hostname inteiro', async () => {
    const p = createApp({ logger: false }).mount(Tenant, { host: /tenant-\d+\.exemplo\.com/ });
    assert.equal((await p.inject({ url: '/whoami', ...at('tenant-7.exemplo.com') })).status, 200);
    assert.equal((await p.inject({ url: '/whoami', ...at('tenant-7.exemplo.com.atacante.dev') })).status, 404);
  });
});

describe('F-35 · registro', () => {
  it('host no grupo e no mount ao mesmo tempo é erro', () => {
    assert.throws(
      () => createApp().group({ host: 'a.com' }, (g) => g.mount(ApiUsers, { host: 'b.com' })),
      /"host" is already set by an outer group \(a\.com\)/,
    );
    assert.throws(() => createApp().group({ host: 'a.com' }, (g) => g.group({ host: 'b.com' }, () => {})), /already set/);
  });

  it('a mesma rota no mesmo host duas vezes é erro; em hosts diferentes, não', () => {
    assert.throws(
      () => createApp().mount(ApiUsers, { host: 'a.com' }).mount(ApiUsers, { host: 'a.com' }),
      /on host a\.com is already registered/,
    );
    assert.doesNotThrow(() => createApp().mount(ApiUsers, { host: 'a.com' }).mount(ApiUsers, { host: 'b.com' }));
  });

  it('regras inválidas falham no registro', () => {
    assert.throws(() => createApp().mount(ApiUsers, { host: 'a.*.com' }), /only allowed as "\*\.domain"/);
    assert.throws(() => createApp().mount(ApiUsers, { host: 'a.com:8080' }), /without the port/);
    assert.throws(() => createApp().mount(ApiUsers, { host: [] }), /cannot be empty/);
    assert.throws(() => createApp().mount(ApiUsers, { host: 'a b' }), /invalid allowedHosts rule|invalid/);
  });

  it('host fora do allowedHosts falha por padrão', () => {
    const app = createApp({ allowedHosts: ['api.exemplo.com', '*.clientes.exemplo.com'] });
    assert.doesNotThrow(() => app.mount(ApiUsers, { host: 'api.exemplo.com' }).mount(Tenant, { host: '*.clientes.exemplo.com' }));
    assert.throws(
      () => app.mount(AdminUsers, { host: 'admin.exemplo.com' }),
      /admin\.exemplo\.com, which no allowedHosts rule accepts.*unreachableHosts: 'warn'/,
    );
    assert.doesNotThrow(() => app.mount(Reports, { host: /qualquer/ }), 'RegExp não é conferida');
  });

  it("unreachableHosts: 'warn' registra e avisa; 'off' não confere", () => {
    const warn = mock.fn();
    const log = {
      debug() {},
      info() {},
      warn,
      error() {},
      child() {
        return log;
      },
    };
    createApp({ logger: log, allowedHosts: ['api.exemplo.com'], unreachableHosts: 'warn' }).mount(AdminUsers, {
      host: 'admin.exemplo.com',
    });
    assert.equal(warn.mock.callCount(), 1, 'um aviso por mount e host, não por rota');
    assert.doesNotThrow(() =>
      createApp({ allowedHosts: ['api.exemplo.com'], unreachableHosts: 'off' }).mount(AdminUsers, { host: 'admin.exemplo.com' }),
    );
  });
});

describe('F-35 · OpenAPI por host', () => {
  const app = createApp({ logger: false })
    .mount(ApiUsers, { host: 'api.exemplo.com' })
    .mount(AdminUsers, { prefix: '/admin-users', host: 'admin.exemplo.com' })
    .mount(Health)
    .openapi();
  const paths = (doc: unknown) => Object.keys((doc as { paths: object }).paths).sort();

  it('openapiDocument({ host }) traz as rotas do host e as sem host; sem host, só as sem host', () => {
    assert.deepEqual(paths(app.openapiDocument({ host: 'api.exemplo.com' })), ['/health', '/users']);
    assert.deepEqual(paths(app.openapiDocument({ host: 'ADMIN.exemplo.com' })), ['/admin-users', '/health']);
    assert.deepEqual(paths(app.openapiDocument({})), ['/health']);
  });

  it('o /openapi.json servido documenta o host da requisição', async () => {
    assert.deepEqual(paths((await app.inject({ url: '/openapi.json', ...at('api.exemplo.com') })).json()), ['/health', '/users']);
    assert.deepEqual(paths((await app.inject({ url: '/openapi.json', ...at('admin.exemplo.com') })).json()), ['/admin-users', '/health']);
    assert.deepEqual(paths((await app.inject({ url: '/openapi.json', ...at('outro.dev') })).json()), ['/health']);
  });
});

describe('compileRouteHost', () => {
  it('normaliza maiúsculas e IDN', () => {
    assert.equal(compileRouteHost('API.Exemplo.com').key, 'api.exemplo.com');
    assert.equal(compileRouteHost('café.exemplo.com').key, 'xn--caf-dma.exemplo.com');
    assert.equal(compileRouteHost('*.Exemplo.com').test('a.exemplo.com'), true);
  });
});

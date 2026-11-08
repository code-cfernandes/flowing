import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { type Context, createApp, Get, type MountedGroup, Post, type RouteGroupScope, Router, Type } from 'flowingts';
import { compileRouteHost, hostReachability } from '../../src/utils/origin-match.ts';

const at = (host: string, extra: Record<string, string> = {}) => ({ headers: { host, ...extra } });
const named = (name: string) => {
  @Router('/')
  class R {
    @Get('/x') x() {
      return name;
    }
  }
  Object.defineProperty(R, 'name', { value: name });
  return R;
};

describe('consolidação · prioridade de hosts', () => {
  it('host exato vence curinga e fallback, em qualquer ordem de registro', async () => {
    for (const order of [
      ['any', 'wild', 'exact'],
      ['exact', 'wild', 'any'],
      ['wild', 'exact', 'any'],
    ]) {
      const app = createApp({ logger: false });
      for (const kind of order) {
        if (kind === 'any') app.mount(named('any'));
        if (kind === 'wild') app.mount(named('wild'), { host: '*.exemplo.com' });
        if (kind === 'exact') app.mount(named('exact'), { host: 'vip.exemplo.com' });
      }
      assert.equal((await app.inject({ url: '/x', ...at('vip.exemplo.com') })).body, 'exact', order.join(','));
      assert.equal((await app.inject({ url: '/x', ...at('a.exemplo.com') })).body, 'wild', order.join(','));
      assert.equal((await app.inject({ url: '/x', ...at('outro.dev') })).body, 'any', order.join(','));
    }
  });

  it('curingas sobrepostos: o mais específico vence, independentemente da ordem', async () => {
    for (const reversed of [false, true]) {
      const app = createApp({ logger: false });
      const generic = () => app.mount(named('generic'), { host: '*.exemplo.com' });
      const api = () => app.mount(named('api'), { host: '*.api.exemplo.com' });
      if (reversed) {
        api();
        generic();
      } else {
        generic();
        api();
      }
      assert.equal((await app.inject({ url: '/x', ...at('v1.api.exemplo.com') })).body, 'api');
      assert.equal((await app.inject({ url: '/x', ...at('www.exemplo.com') })).body, 'generic');
    }
  });

  it('curinga de vários níveis; o domínio raiz não casa', async () => {
    const app = createApp({ logger: false }).mount(named('wild'), { host: '*.exemplo.com' });
    assert.equal((await app.inject({ url: '/x', ...at('a.exemplo.com') })).status, 200);
    assert.equal((await app.inject({ url: '/x', ...at('a.b.exemplo.com') })).status, 200);
    assert.equal((await app.inject({ url: '/x', ...at('exemplo.com') })).status, 404);
  });

  it('RegExp perde para curinga, e entre RegExp vale a ordem de registro', async () => {
    const app = createApp({ logger: false })
      .mount(named('re1'), { host: /.+\.exemplo\.com/ })
      .mount(named('re2'), { host: /a\..+/ })
      .mount(named('wild'), { host: '*.b.exemplo.com' });
    assert.equal((await app.inject({ url: '/x', ...at('x.b.exemplo.com') })).body, 'wild');
    assert.equal((await app.inject({ url: '/x', ...at('a.exemplo.com') })).body, 're1');
    assert.equal((await app.inject({ url: '/x', ...at('a.outro.dev') })).body, 're2');
  });

  it('405 por host: o Allow considera só as rotas efetivas do host; a porta é ignorada', async () => {
    @Router('/u')
    class Read {
      @Get('/') list() {
        return [];
      }
    }
    @Router('/u')
    class Write {
      @Post('/') create() {
        return {};
      }
    }
    const app = createApp({ logger: false }).mount(Read, { host: 'api.exemplo.com' }).mount(Write, { host: 'admin.exemplo.com' });
    const res = await app.inject({ method: 'POST', url: '/u', ...at('api.exemplo.com:8443') });
    assert.equal(res.status, 405);
    assert.equal(res.headers.allow, 'GET, HEAD, OPTIONS');
  });

  it('com trustProxy, só o host do proxy confiável escolhe a rota', async () => {
    const trusted = createApp({ logger: false, trustProxy: 1 }).mount(named('admin'), { host: 'admin.exemplo.com' }).mount(named('any'));
    assert.equal((await trusted.inject({ url: '/x', ...at('interno', { 'x-forwarded-host': 'admin.exemplo.com' }) })).body, 'admin');
    const untrusted = createApp({ logger: false }).mount(named('admin'), { host: 'admin.exemplo.com' }).mount(named('any'));
    assert.equal((await untrusted.inject({ url: '/x', ...at('interno', { 'x-forwarded-host': 'admin.exemplo.com' }) })).body, 'any');
  });
});

describe('consolidação · registro em duas fases', () => {
  @Router('/')
  class M {
    @Get('/a') a() {
      return 'a';
    }
    @Get('/b') b() {
      return 'b';
    }
  }

  it('lista de hosts com conflito falha sem deixar registros parciais', async () => {
    const app = createApp({ logger: false }).mount(M, { host: 'x.com' });
    assert.throws(() => app.mount(M, { host: ['y.com', 'x.com'] }), /already registered/);
    assert.equal((await app.inject({ url: '/a', ...at('y.com') })).status, 404);
  });

  it('mount com vários métodos: um conflito no segundo não deixa o primeiro registrado', async () => {
    @Router('/')
    class OnlyB {
      @Get('/b') b() {
        return 'b';
      }
    }
    const app = createApp({ logger: false }).mount(OnlyB);
    assert.throws(() => app.mount(M), /GET \/b is already registered/);
    assert.equal((await app.inject('/a')).status, 404);
  });

  it('conflito que só o roteador detecta (nome de parâmetro diferente) também é desfeito', async () => {
    @Router('/')
    class P1 {
      @Get('/i/:id') g() {
        return 1;
      }
    }
    @Router('/')
    class P2 {
      @Get('/ok') ok() {
        return 'ok';
      }
      @Get('/i/:uid') g() {
        return 2;
      }
    }
    const app = createApp({ logger: false }).mount(P1);
    assert.throws(() => app.mount(P2));
    assert.equal((await app.inject('/ok')).status, 404, 'rollback do /ok');
    assert.equal((await app.inject('/i/1')).body, '1');
  });

  it('group() assíncrono falha sem deixar rotas, inclusive com thenable', async () => {
    const app = createApp({ logger: false });
    assert.throws(
      () =>
        app.group({}, async (g) => {
          g.mount(M);
        }),
      /must be synchronous/,
    );
    assert.throws(
      () =>
        app.group({}, (g) => {
          g.mount(M);
          // biome-ignore lint/suspicious/noThenProperty: o teste precisa de um thenable que não é Promise.
          return { then() {} };
        }),
      /must be synchronous/,
    );
    assert.equal((await app.inject('/a')).status, 404);
  });

  it('erro no meio do group() descarta o lote inteiro, inclusive grupos aninhados', async () => {
    @Router('/')
    class Other {
      @Get('/c') c() {
        return 'c';
      }
    }
    const app = createApp({ logger: false });
    assert.throws(
      () =>
        app.group({}, (g) => {
          g.mount(Other);
          g.group({ prefix: '/n' }, (n) => n.mount(M));
          throw new Error('falhou');
        }),
      /falhou/,
    );
    assert.equal((await app.inject('/c')).status, 404);
    assert.equal((await app.inject('/n/a')).status, 404);
    app.group({}, (g) => g.mount(Other));
    assert.equal((await app.inject('/c')).status, 200, 'depois do erro, o app continua utilizável');
  });

  it('conflito dentro do próprio lote do group() é detectado', () => {
    assert.throws(() => createApp().group({}, (g) => g.mount(M).mount(M)), /GET \/a is already registered/);
  });
});

describe('consolidação · alcançabilidade (unreachableHosts)', () => {
  const R = named('r');

  it('curinga com um host permitido dentro dele é aceito', () => {
    assert.doesNotThrow(() => createApp({ allowedHosts: ['acme.clientes.exemplo.com'] }).mount(R, { host: '*.clientes.exemplo.com' }));
  });

  it('host exato com allowedHosts com porta é aceito', () => {
    assert.doesNotThrow(() => createApp({ allowedHosts: ['api.exemplo.com:8443'] }).mount(R, { host: 'api.exemplo.com' }));
  });

  it('curingas sobrepostos nos dois sentidos são aceitos; sem interseção, erro', () => {
    assert.doesNotThrow(() => createApp({ allowedHosts: ['*.exemplo.com'] }).mount(R, { host: '*.api.exemplo.com' }));
    assert.doesNotThrow(() => createApp({ allowedHosts: ['*.api.exemplo.com'] }).mount(R, { host: '*.exemplo.com' }));
    assert.throws(
      () => createApp({ allowedHosts: ['*.outro.com', 'api.exemplo.com'] }).mount(R, { host: '*.clientes.exemplo.com' }),
      /no allowedHosts rule accepts/,
    );
  });

  it('sem como provar (RegExp), só avisa', () => {
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
    createApp({ logger: log, allowedHosts: [/.+\.exemplo\.com/] }).mount(R, { host: '*.clientes.exemplo.com' });
    createApp({ logger: log, allowedHosts: ['api.exemplo.com'] }).mount(named('s'), { host: /api\..+/ });
    assert.equal(warn.mock.callCount(), 2);
    assert.match(String(warn.mock.calls[0]!.arguments[1]), /could not verify/);
  });

  it('hostReachability', () => {
    const r = (h: string | RegExp) => compileRouteHost(h);
    assert.equal(hostReachability(r('api.exemplo.com'), ['API.exemplo.com']), 'yes');
    assert.equal(hostReachability(r('api.exemplo.com'), ['*.exemplo.com']), 'yes');
    assert.equal(hostReachability(r('exemplo.com'), ['*.exemplo.com']), 'no');
    assert.equal(hostReachability(r('api.exemplo.com'), [/api\.exemplo\.com/]), 'yes');
    assert.equal(hostReachability(r('*.exemplo.com'), ['exemplo.com']), 'no');
  });
});

describe('consolidação · OpenAPI documenta o handler executado', () => {
  const schema = (prop: string) => ({ response: { 200: Type.Object({ [prop]: Type.String() }) } });
  @Router('/users')
  class Global {
    @Get('/', schema('global')) l() {
      return { global: 'x' };
    }
  }
  @Router('/users')
  class Admin {
    @Get('/', schema('admin')) l() {
      return { admin: 'x' };
    }
  }
  @Router('/users')
  class Tenants {
    @Get('/', schema('tenant')) l() {
      return { tenant: 'x' };
    }
  }

  const documented = (doc: unknown) =>
    Object.keys((doc as any).paths['/users'].get.responses['200'].content['application/json'].schema.properties)[0];

  for (const order of ['global-first', 'specific-first']) {
    it(`mesmo método e path: o documento bate com o roteador (${order})`, async () => {
      const app = createApp({ logger: false }).openapi();
      if (order === 'global-first') app.mount(Global).mount(Tenants, { host: '*.exemplo.com' }).mount(Admin, { host: 'admin.exemplo.com' });
      else app.mount(Admin, { host: 'admin.exemplo.com' }).mount(Tenants, { host: '*.exemplo.com' }).mount(Global);

      for (const [host, expected] of [
        ['admin.exemplo.com', 'admin'],
        ['acme.exemplo.com', 'tenant'],
        ['outro.dev', 'global'],
      ] as const) {
        const executed = Object.keys((await app.inject({ url: '/users', ...at(host) })).json() as object)[0];
        assert.equal(executed, expected, `executado em ${host}`);
        assert.equal(documented(app.openapiDocument({ host })), expected, `openapiDocument em ${host}`);
        assert.equal(documented((await app.inject({ url: '/openapi.json', ...at(host) })).json()), expected, `/openapi.json em ${host}`);
      }
      assert.equal(documented(app.openapiDocument({})), 'global');
    });
  }

  it('o tipo Context continua funcionando com rotas sem host', async () => {
    @Router('/')
    class C {
      @Get('/h') h(ctx: Context) {
        return ctx.hostname;
      }
    }
    assert.equal((await createApp({ logger: false }).mount(C).inject('/h')).body, 'localhost');
  });
});

describe('0.11.2 · ciclo de vida dos grupos', () => {
  @Router('/')
  class L {
    @Get('/late') late() {
      return 'late';
    }
  }
  @Router('/')
  class N {
    @Get('/n') n() {
      return 'n';
    }
  }

  it('registro depois de um await num group() assíncrono é rejeitado, sem unhandledRejection', async () => {
    const error = mock.fn();
    const log = {
      debug() {},
      info() {},
      warn() {},
      error,
      child() {
        return log;
      },
    };
    const unhandled = mock.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const app = createApp({ logger: log });
      assert.throws(
        () =>
          app.group({}, async (g) => {
            await Promise.resolve();
            g.mount(L);
          }),
        /must be synchronous/,
      );
      await new Promise((r) => setTimeout(r, 20));
      assert.equal((await app.inject('/late')).status, 404);
      assert.equal(unhandled.mock.callCount(), 0);
      assert.match(String((error.mock.calls[0]!.arguments[0] as { err: Error }).err.message), /already finished/);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('o escopo e os MountedGroup de um grupo encerrado não registram mais nada', () => {
    const app = createApp({ logger: false });
    let scope: RouteGroupScope | undefined;
    let mounted: MountedGroup<N> | undefined;
    app.group({ prefix: '/g' }, (g) => {
      scope = g;
      mounted = g.mount(N);
    });
    assert.throws(() => scope!.mount(L), /already finished/);
    assert.throws(() => scope!.group({}, () => {}), /already finished/);
    assert.throws(() => mounted!.mount(L), /already finished/);
    assert.throws(() => mounted!.get('/x', (r) => r.n), /already finished/);
  });

  it('grupo aninhado que falha, com o erro capturado pelo externo, descarta só as rotas dele', async () => {
    const app = createApp({ logger: false });
    app.group({}, (g) => {
      g.mount(L);
      try {
        g.group({ prefix: '/in' }, (inner) => {
          inner.mount(N);
          throw new Error('falhou');
        });
      } catch {}
    });
    assert.equal((await app.inject('/late')).status, 200, 'as rotas do externo entram');
    assert.equal((await app.inject('/in/n')).status, 404, 'as do aninhado que falhou, não');
  });

  it('OpenAPI: /users e /users/ são o mesmo path na seleção por host', async () => {
    const s = (p: string) => ({ response: { 200: Type.Object({ [p]: Type.String() }) } });
    @Router('/users')
    class G {
      @Get('/', s('global')) l() {
        return { global: 'x' };
      }
    }
    @Router('/')
    class A {
      @Get('/users', s('admin')) l() {
        return { admin: 'x' };
      }
    }
    for (const swap of [false, true]) {
      const app = createApp({ logger: false });
      if (swap) app.mount(G).mount(A, { host: 'admin.ex.com' });
      else app.mount(A, { host: 'admin.ex.com' }).mount(G);
      const executed = Object.keys((await app.inject({ url: '/users', ...at('admin.ex.com') })).json() as object)[0];
      const doc = app.openapiDocument({ host: 'admin.ex.com' }) as any;
      assert.equal(executed, 'admin');
      assert.equal(Object.keys(doc.paths['/users'].get.responses['200'].content['application/json'].schema.properties)[0], 'admin');
    }
  });

  it('duplicidade dentro do lote considera /x e /x/', () => {
    @Router('/u')
    class A1 {
      @Get('/') a() {
        return 1;
      }
    }
    @Router('/')
    class A2 {
      @Get('/u') a() {
        return 2;
      }
    }
    assert.throws(() => createApp().group({}, (g) => g.mount(A1).mount(A2)), /already registered/);
  });
});

describe('0.11.3 · atomicidade de cada mount() dentro de um grupo', () => {
  it('mount() que falha no meio, com o erro capturado no callback, não deixa rotas', async () => {
    @Router('/')
    class Existing {
      @Get('/b') b() {
        return 'existing';
      }
    }
    @Router('/')
    class New {
      @Get('/a') a() {
        return 'new';
      }
      @Get('/b') b() {
        return 'conflict';
      }
    }
    @Router('/')
    class Ok {
      @Get('/c') c() {
        return 'c';
      }
    }
    const app = createApp({ logger: false }).mount(Existing);
    app.group({}, (g) => {
      try {
        g.mount(New);
      } catch {}
      g.mount(Ok);
    });
    assert.equal((await app.inject('/a')).status, 404, 'parte do mount que falhou não entra');
    assert.equal((await app.inject('/b')).body, 'existing');
    assert.equal((await app.inject('/c')).status, 200, 'os mounts bem-sucedidos do grupo entram');
  });

  it('rota manual com conflito capturado dentro do grupo também não deixa rastro', async () => {
    @Router('/')
    class M {
      @Get('/x') x() {
        return 'x';
      }
    }
    const app = createApp({ logger: false });
    app.group({}, (g) => {
      const m = g.mount(M);
      try {
        m.get('/x', (r) => r.x);
      } catch {}
    });
    assert.equal((await app.inject('/x')).status, 200);
    assert.deepEqual(Object.keys((app.openapiDocument() as any).paths), ['/x'], 'a rota não ficou duplicada');
  });
});

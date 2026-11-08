import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type Context, createApp, Get, OnError, OnResponse, OnSend, type OnSendHook, type ResponseInfo, Router } from 'flowingts';

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const tag =
  (name: string, trail: string[]): OnSendHook =>
  (ctx) => {
    trail.push(name);
    ctx.res.setHeader('x-hook', [...trail].join(','));
  };

describe('F-43 · @OnSend e hooks.onSend', () => {
  it('ordem: app → grupo → mount → classe → método → rota manual; só nas rotas do escopo', async () => {
    const trail: string[] = [];
    @Router('/r')
    @OnSend(tag('classe', trail))
    class R {
      @Get('/a') @OnSend(tag('método', trail)) a() {
        return 'a';
      }
      @Get('/b') b() {
        return 'b';
      }
    }
    @Router('/fora')
    class Fora {
      @Get('/') x() {
        return 'x';
      }
    }
    const app = createApp({ logger: false, shutdown: false });
    app.onSend(tag('app', trail));
    app.group({ hooks: { onSend: tag('grupo', trail) } }, (g) =>
      g.mount(R, { hooks: { onSend: tag('mount', trail) } }).get('/m', (r) => r.a, { hooks: { onSend: tag('manual', trail) } }),
    );
    app.mount(Fora);

    const take = async (url: string) => {
      trail.length = 0;
      await app.inject(url);
      return [...trail];
    };
    assert.deepEqual(await take('/r/a'), ['app', 'grupo', 'mount', 'classe', 'método']);
    assert.deepEqual(await take('/r/b'), ['app', 'grupo', 'mount', 'classe']);
    assert.deepEqual(await take('/r/m'), ['app', 'grupo', 'mount', 'classe', 'método', 'manual']);
    assert.deepEqual(await take('/fora'), ['app'], 'fora do escopo, só o do app');
    assert.deepEqual(await take('/nada'), ['app'], '404: só o do app');
  });

  it('pode trocar o corpo; se lançar, a resposta original sai e o erro é logado', async () => {
    const errors: string[] = [];
    const logger = {
      info() {},
      warn() {},
      debug() {},
      error: (_o: unknown, m?: string) => void errors.push(String(m)),
      child: () => logger,
    };
    @Router('/')
    class R {
      @Get('/troca') @OnSend((_ctx, p) => ({ body: `${String(p.body)}!`, contentType: p.contentType })) troca() {
        return 'oi';
      }
      @Get('/falha')
      @OnSend(() => {
        throw new Error('x');
      })
      falha() {
        return 'original';
      }
    }
    const app = createApp({ logger, shutdown: false });
    app.mount(R);
    assert.equal((await app.inject('/troca')).body, 'oi!');
    assert.equal((await app.inject('/falha')).body, 'original');
    assert.deepEqual(errors, ['onSend hook failed; sending original response']);
  });
});

describe('F-43 · @OnError', () => {
  it('do mais específico para o app, com a fase; quem responde encerra a cadeia', async () => {
    const trail: string[] = [];
    @Router('/e')
    @OnError((_e, _c, phase) => void trail.push(`classe:${phase}`))
    class E {
      @Get('/a') @OnError(() => void trail.push('método')) a() {
        throw new Error('a');
      }
      @Get('/responde')
      @OnError((_e, ctx) => void ctx.status(418).json({ tratado: true }))
      responde() {
        throw new Error('b');
      }
    }
    const app = createApp({ logger: false, shutdown: false });
    app.onError(() => void trail.push('app'));
    app.group({ hooks: { onError: () => void trail.push('grupo') } }, (g) => g.mount(E));

    assert.equal((await app.inject('/e/a')).status, 500);
    assert.deepEqual(trail, ['método', 'classe:handler', 'grupo', 'app']);

    trail.length = 0;
    const r = await app.inject('/e/responde');
    assert.equal(r.status, 418);
    assert.deepEqual(trail, [], 'o hook do método respondeu: classe, grupo e app não rodam');
  });

  it('erro antes do roteamento (middleware global) só chega aos onError do app', async () => {
    let scoped = 0;
    let global = 0;
    @Router('/')
    @OnError(() => void scoped++)
    class R {
      @Get('/x') x() {
        return 'x';
      }
    }
    const app = createApp({ logger: false, shutdown: false });
    app.use(() => {
      throw new Error('antes');
    });
    app.onError(() => void global++);
    app.mount(R);
    assert.equal((await app.inject('/x')).status, 500);
    assert.equal(global, 1);
    assert.equal(scoped, 0);
  });
});

describe('F-43 · @OnResponse', () => {
  it('exatamente uma vez, depois dos do app, inclusive cancelada e em stream; nunca fora do escopo', async (t) => {
    let hangEntered!: () => void;
    const inHandler = new Promise<void>((r) => (hangEntered = r));
    const seen: string[] = [];
    const infos: ResponseInfo[] = [];
    @Router('/o')
    @OnResponse((ctx, info) => {
      seen.push(`classe ${ctx.path}`);
      infos.push(info);
    })
    class O {
      @Get('/ok') ok() {
        return 'ok';
      }
      @Get('/sse') sse(ctx: Context) {
        const s = ctx.sse();
        s.send({ data: 1 });
        s.close();
      }
      @Get('/hang') hang() {
        hangEntered();
        return new Promise(() => {});
      }
    }
    @Router('/fora')
    class Fora {
      @Get('/') x() {
        return 'x';
      }
    }
    const app = createApp({ logger: false, shutdown: false });
    app.onResponse((ctx) => void seen.push(`app ${ctx.path}`));
    app.mount(O).mount(Fora);
    const server = await app.listen(0);
    t.after(() => app.close(500));
    const port = (server.address() as AddressInfo).port;
    const get = (path: string) =>
      new Promise<void>((ok) => http.get({ port, path }, (r) => r.resume().on('end', () => ok())).on('error', () => ok()));
    try {
      await get('/o/ok');
      await get('/o/sse');
      await get('/fora');
      await get('/nada');
      const req = http.get({ port, path: '/o/hang' });
      req.on('error', () => {});
      await inHandler; // só derruba com o handler já rodando
      req.destroy();
      await tick(50);
    } finally {
      await app.close(500);
    }
    const scopedPaths = seen.filter((s) => s.startsWith('classe')).sort();
    assert.deepEqual(scopedPaths, ['classe /o/hang', 'classe /o/ok', 'classe /o/sse']);
    assert.ok(seen.indexOf('app /o/ok') < seen.indexOf('classe /o/ok'), 'o do app roda antes');
    assert.equal(infos.find((i) => i.route?.path === '/o/sse')?.streaming, true);
    assert.equal(infos.find((i) => i.route?.path === '/o/hang')?.abortReason, 'CLIENT_DISCONNECTED');
  });

  it('herança: a filha herda os hooks da classe pai, e a pai não ganha os da filha', async () => {
    const seen: string[] = [];
    @Router('/pai')
    @OnResponse((ctx) => void seen.push(`pai ${ctx.path}`))
    class Pai {
      @Get('/') x() {
        return 'x';
      }
    }
    @Router('/filha')
    @OnResponse((ctx) => void seen.push(`filha ${ctx.path}`))
    class Filha extends Pai {}
    const app = createApp({ logger: false, shutdown: false });
    app.mount(Pai).mount(Filha);
    await app.inject('/pai');
    await app.inject('/filha');
    await tick();
    assert.deepEqual(seen.sort(), ['filha /filha', 'pai /filha', 'pai /pai']);
  });

  it('estáticos dentro de um grupo recebem os hooks do grupo', async () => {
    const seen: (string | undefined)[] = [];
    const app = createApp({ logger: false, shutdown: false });
    app.group({ hooks: { onResponse: (_c, i) => void seen.push(i.route?.path) } }, (g) =>
      g.static('/assets', fileURLToPath(new URL('../fixtures', import.meta.url))),
    );
    assert.equal((await app.inject('/assets/tls/README.md')).status, 200);
    await tick();
    assert.deepEqual(seen, ['/assets/*']);
  });
});

describe('F-43 · custo', () => {
  async function ownProps(app: ReturnType<typeof createApp>) {
    const own: string[][] = [];
    app.use(async (ctx, next) => {
      await next();
      own.push(
        Object.getOwnPropertySymbols(ctx.res)
          .map(String)
          .filter((k) => k.includes('flowing.')),
      );
    });
    const server = await app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      await new Promise<void>((ok) => http.get({ port, path: '/x' }, (r) => r.resume().on('end', () => ok())));
    } finally {
      await app.close(500);
    }
    return own;
  }
  @Router('/')
  @OnSend(() => {})
  @OnError(() => {})
  class SemFim {
    @Get('/x') x() {
      return 'x';
    }
  }
  @Router('/')
  @OnResponse(() => {})
  class ComFim {
    @Get('/x') x() {
      return 'x';
    }
  }

  it('onSend e onError de escopo não ligam a observação do fim', async () => {
    const app = createApp({ logger: false, shutdown: false });
    app.mount(SemFim);
    assert.deepEqual(await ownProps(app), [[]]);
  });

  it('um onResponse de escopo liga a observação (ttfbMs medido)', async () => {
    const app = createApp({ logger: false, shutdown: false });
    app.mount(ComFim);
    assert.deepEqual(await ownProps(app), [['Symbol(flowing.headersAt)']]);
  });

  it('ctx.route continua sem os hooks no JSON', async () => {
    @Router('/')
    @OnSend(() => {})
    class J {
      @Get('/j') j(ctx: Context) {
        return { route: ctx.route };
      }
    }
    const app = createApp({ logger: false, shutdown: false });
    app.mount(J);
    assert.deepEqual((await app.inject('/j')).json(), { route: { method: 'GET', path: '/j', owner: 'J', handler: 'j' } });
  });
});

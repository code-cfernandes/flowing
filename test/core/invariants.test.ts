/**
 * Garantias que a refatoração de desempenho (F-39) não pode quebrar e que ainda não tinham teste
 * (docs/ARCHITECTURE.md, "Garantias que não estão nos testes").
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Context, cors, createApp, Get, type Middleware, Post, Router } from 'sashiko';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('invariante 1 · isolamento entre requisições', () => {
  @Router('/')
  class Iso {
    @Get('/i/:n') async i(ctx: Context<'/i/:n'>) {
      const n = ctx.params.n;
      ctx.state.mine = n;
      ctx.header('X-Mine', n);
      if (n === '0') ctx.setCookie('only-zero', '1');
      await tick(Number(n) % 7); // intercala as requisições
      return { n, state: ctx.state.mine, query: ctx.query, id: ctx.id };
    }
  }

  it('estado, headers, query, cookies e request id não vazam entre requisições concorrentes', async () => {
    const app = createApp({ logger: false }).mount(Iso);
    const responses = await Promise.all(Array.from({ length: 40 }, (_, i) => app.inject(`/i/${i}?q=${i}`)));
    const ids = new Set<string>();
    responses.forEach((res, i) => {
      const body = res.json<{ n: string; state: string; query: { q: string }; id: string }>();
      assert.equal(body.n, String(i));
      assert.equal(body.state, String(i));
      assert.deepEqual(body.query, { q: String(i) });
      assert.equal(res.headers['x-mine'], String(i));
      assert.equal(res.headers['set-cookie'] !== undefined, i === 0, `cookie só na requisição 0 (requisição ${i})`);
      ids.add(body.id);
    });
    assert.equal(ids.size, 40, 'um request id por requisição');
  });
});

describe('invariante 2 · headers de segurança sobrescrevíveis', () => {
  it('middleware global e handler podem trocar ou remover os headers padrão', async () => {
    const relaxCsp: Middleware = async (ctx, next) => {
      ctx.header('Content-Security-Policy', "default-src 'self'");
      await next();
    };
    @Router('/')
    class H {
      @Get('/mw') mw() {
        return 'mw';
      }
      @Get('/handler') handler(ctx: Context) {
        ctx.header('X-Frame-Options', 'SAMEORIGIN');
        ctx.res.removeHeader('Referrer-Policy');
        return 'h';
      }
    }
    const app = createApp({ logger: false }).use(relaxCsp).mount(H);
    const mw = await app.inject('/mw');
    assert.equal(mw.headers['content-security-policy'], "default-src 'self'");
    assert.equal(mw.headers['x-content-type-options'], 'nosniff', 'os outros continuam');
    const h = await app.inject('/handler');
    assert.equal(h.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(h.headers['referrer-policy'], undefined);
  });
});

describe('invariante 3 · campos do ctx estáveis durante a requisição', () => {
  it('url, query, host, protocol e log devolvem o mesmo valor em middleware e handler', async () => {
    const seen: Record<string, unknown> = {};
    const early: Middleware = async (ctx, next) => {
      seen.url = ctx.url.href;
      seen.query = ctx.query;
      seen.host = ctx.host;
      seen.hostname = ctx.hostname;
      seen.protocol = ctx.protocol;
      seen.log = ctx.log;
      await next();
    };
    @Router('/')
    class S {
      @Get('/s') s(ctx: Context) {
        assert.equal(ctx.url.href, seen.url);
        assert.equal(ctx.query, seen.query, 'mesmo objeto');
        assert.equal(ctx.host, seen.host);
        assert.equal(ctx.hostname, seen.hostname);
        assert.equal(ctx.protocol, seen.protocol);
        assert.equal(ctx.log, seen.log, 'mesmo logger');
        return { href: ctx.url.href };
      }
    }
    const res = await createApp({ logger: false })
      .use(early)
      .mount(S)
      .inject({ url: '/s?a=1&b=2', headers: { host: 'API.exemplo.com:8080' } });
    assert.deepEqual(res.json(), { href: 'http://api.exemplo.com:8080/s?a=1&b=2' });
    assert.deepEqual(seen.query, { a: '1', b: '2' });
    assert.equal(seen.hostname, 'API.exemplo.com');
  });
});

describe('invariante 4 · headers de segurança no preflight e no Host inválido', () => {
  @Router('/')
  class P {
    @Post('/p') p() {
      return 'p';
    }
  }

  it('preflight CORS recebe os headers de segurança', async () => {
    const app = createApp({ logger: false })
      .use(cors({ origin: 'https://app.exemplo.com' }))
      .mount(P);
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/p',
      headers: { origin: 'https://app.exemplo.com', 'access-control-request-method': 'POST' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['content-security-policy'], "default-src 'none'; frame-ancestors 'none'");
  });

  it('400 de Host inválido recebe os headers de segurança', async () => {
    const app = createApp({ logger: false, allowedHosts: ['api.exemplo.com'] }).mount(P);
    for (const host of ['a b', 'outro.dev']) {
      const res = await app.inject({ url: '/p', headers: { host } });
      assert.equal(res.status, 400, host);
      assert.equal(res.headers['x-content-type-options'], 'nosniff', host);
      assert.equal(res.headers['x-frame-options'], 'DENY', host);
    }
  });
});

describe('invariante 5 · body disponível nos middlewares globais', () => {
  it('um middleware global lê ctx.body antes do handler', async () => {
    let audited: unknown;
    const audit: Middleware = async (ctx, next) => {
      audited = ctx.body;
      await next();
    };
    @Router('/')
    class B {
      @Post('/b') b(ctx: Context) {
        return ctx.body;
      }
    }
    const res = await createApp({ logger: false })
      .use(audit)
      .mount(B)
      .inject({ method: 'POST', url: '/b', body: { a: 1 } });
    assert.deepEqual(audited, { a: 1 });
    assert.deepEqual(res.json(), { a: 1 });
  });
});

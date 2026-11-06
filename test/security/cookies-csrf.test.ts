import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Context, createApp, csrf, Get, Post, Router } from 'sashiko';
import { parseCookies, serializeCookie } from '../../src/utils/cookie.ts';

describe('cookies · leitura', () => {
  it('lê pares, ignora lixo, decodifica e mantém o primeiro em nomes repetidos', () => {
    const c = parseCookies('a=1; b=ol%C3%A1; lixo; a=2; c="q"; d=%E0%A4%A');
    assert.deepEqual({ ...c }, { a: '1', b: 'olá', c: 'q', d: '%E0%A4%A' });
  });

  it('__proto__ é um cookie comum, sem poluir protótipos', () => {
    const c = parseCookies('__proto__=x; constructor=y');
    assert.equal(Object.getPrototypeOf(c), null);
    assert.equal(c['__proto__'], 'x');
    assert.equal(({} as Record<string, unknown>).x, undefined);
  });
});

describe('cookies · escrita', () => {
  it('aplica padrões seguros', () => {
    assert.equal(serializeCookie('sid', 'a b'), 'sid=a%20b; Path=/; HttpOnly; Secure; SameSite=Lax');
  });

  it('valor com ; e quebra de linha é codificado; nome, path e domain inválidos lançam erro', () => {
    assert.match(serializeCookie('x', 'a;\r\nSet-Cookie: y=1'), /^x=a%3B%0D%0ASet-Cookie%3A%20y%3D1;/);
    assert.throws(() => serializeCookie('a b', '1'));
    assert.throws(() => serializeCookie('a;', '1'));
    assert.throws(() => serializeCookie('a', '1', { path: '/; Domain=evil.com' }));
    assert.throws(() => serializeCookie('a', '1', { domain: 'x.com\r\nX: 1' }));
    assert.throws(() => serializeCookie('a', '1', { maxAge: Number.NaN }));
  });

  it('valida SameSite=None, Partitioned e prefixos', () => {
    assert.throws(() => serializeCookie('a', '1', { sameSite: 'None', secure: false }));
    assert.throws(() => serializeCookie('a', '1', { partitioned: true, secure: false }));
    assert.throws(() => serializeCookie('__Secure-a', '1', { secure: false }));
    assert.throws(() => serializeCookie('__Host-a', '1', { domain: 'exemplo.com' }));
    assert.throws(() => serializeCookie('__Host-a', '1', { path: '/app' }));
    assert.equal(serializeCookie('__Host-a', '1'), '__Host-a=1; Path=/; HttpOnly; Secure; SameSite=Lax');
  });
});

@Router('/c')
class Cookies {
  @Get('/read') read(ctx: Context) { return { ...ctx.cookies }; }
  @Get('/set') set(ctx: Context) {
    ctx.setCookie('sid', 'abc', { maxAge: 3600 }).setCookie('theme', 'dark', { httpOnly: false });
    return { ok: true };
  }
  @Get('/clear') clear(ctx: Context) { ctx.clearCookie('sid'); }
  @Post('/write') write() { return { ok: true }; }
  @Get('/token') token(ctx: Context) { return { token: ctx.state.csrfToken ?? null }; }
}

describe('ctx.cookies, setCookie e clearCookie', () => {
  const app = createApp({ logger: false }).mount(Cookies);

  it('lê os cookies da requisição', async () => {
    const res = await app.inject({ url: '/c/read', headers: { cookie: 'sid=1; theme=dark' } });
    assert.deepEqual(res.json(), { sid: '1', theme: 'dark' });
  });

  it('envia vários Set-Cookie', async () => {
    const res = await app.inject('/c/set');
    assert.deepEqual(res.headers['set-cookie'], [
      'sid=abc; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax',
      'theme=dark; Path=/; Secure; SameSite=Lax',
    ]);
  });

  it('clearCookie expira o cookie', async () => {
    const res = await app.inject('/c/clear');
    assert.deepEqual([res.headers['set-cookie']].flat(), ['sid=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; Secure; SameSite=Lax']);
  });
});

describe('csrf() · origem', () => {
  const app = createApp({ logger: false }).use(csrf({ trustedOrigins: ['https://*.exemplo.dev'] })).mount(Cookies);
  const post = (headers: Record<string, string>) => app.inject({ method: 'POST', url: '/c/write', headers });

  it('métodos seguros passam mesmo de outra origem', async () => {
    const res = await app.inject({ url: '/c/read', headers: { origin: 'https://atacante.com', 'sec-fetch-site': 'cross-site' } });
    assert.equal(res.status, 200);
  });

  it('Sec-Fetch-Site same-origin e none passam; cross-site e same-site são recusados', async () => {
    assert.equal((await post({ 'sec-fetch-site': 'same-origin', origin: 'http://localhost' })).status, 200);
    assert.equal((await post({ 'sec-fetch-site': 'none' })).status, 200);
    const cross = await post({ 'sec-fetch-site': 'cross-site', origin: 'https://atacante.com' });
    assert.equal(cross.status, 403);
    assert.deepEqual(cross.json(), { error: 'Cross-origin request blocked' });
    assert.equal((await post({ 'sec-fetch-site': 'same-site', origin: 'https://irmao.localhost' })).status, 403);
    assert.equal((await post({ 'sec-fetch-site': 'cross-site' })).status, 403, 'cross-site sem Origin');
  });

  it('origem confiável passa, inclusive com cross-site', async () => {
    assert.equal((await post({ 'sec-fetch-site': 'cross-site', origin: 'https://app.exemplo.dev' })).status, 200);
    assert.equal((await post({ origin: 'https://app.exemplo.dev' })).status, 200);
  });

  it('sem Sec-Fetch-Site, compara o Origin com a própria origem', async () => {
    assert.equal((await post({ origin: 'http://localhost' })).status, 200);
    assert.equal((await post({ origin: 'http://localhost.atacante.com' })).status, 403);
    assert.equal((await post({ origin: 'https://localhost' })).status, 403, 'esquema diferente');
    assert.equal((await post({ origin: 'null' })).status, 403);
  });

  it('sem Origin nem Sec-Fetch-Site (cliente que não é navegador) passa', async () => {
    assert.equal((await post({})).status, 200);
  });
});

describe('csrf() · double-submit token', () => {
  const app = createApp({ logger: false }).use(csrf({ token: true })).mount(Cookies);

  it('GET gera o token no cookie __Host-csrf (legível pelo JS) e em ctx.state', async () => {
    const res = await app.inject('/c/token');
    const { token } = res.json<{ token: string }>();
    assert.match(token, /^[\w-]{43}$/);
    assert.deepEqual([res.headers['set-cookie']].flat(), [`__Host-csrf=${token}; Path=/; Secure; SameSite=Strict`]);
  });

  it('reaproveita o token existente sem reenviar o cookie', async () => {
    const token = 'a'.repeat(43);
    const res = await app.inject({ url: '/c/token', headers: { cookie: `__Host-csrf=${token}` } });
    assert.deepEqual(res.json(), { token });
    assert.equal(res.headers['set-cookie'], undefined);
  });

  it('POST exige header igual ao cookie', async () => {
    const token = 'b'.repeat(43);
    const ok = await app.inject({ method: 'POST', url: '/c/write', headers: { cookie: `__Host-csrf=${token}`, 'x-csrf-token': token } });
    assert.equal(ok.status, 200);
    for (const headers of [
      { cookie: `__Host-csrf=${token}` },
      { 'x-csrf-token': token },
      { cookie: `__Host-csrf=${token}`, 'x-csrf-token': 'c'.repeat(43) },
      { cookie: `__Host-csrf=${token}`, 'x-csrf-token': token.slice(1) },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/c/write', headers });
      assert.equal(res.status, 403);
      assert.deepEqual(res.json(), { error: 'Invalid CSRF token' });
    }
  });

  it('a checagem de origem continua valendo junto com o token', async () => {
    const token = 'd'.repeat(43);
    const res = await app.inject({
      method: 'POST', url: '/c/write',
      headers: { cookie: `__Host-csrf=${token}`, 'x-csrf-token': token, origin: 'https://atacante.com' },
    });
    assert.equal(res.status, 403);
  });

  it('aceita nome, header e atributos próprios; configuração inválida falha na criação', async () => {
    const custom = createApp({ logger: false })
      .use(csrf({ token: { cookieName: 'xsrf', headerName: 'X-XSRF', cookie: { sameSite: 'Lax' } } }))
      .mount(Cookies);
    const res = await custom.inject('/c/token');
    assert.match(String(res.headers['set-cookie']), /^xsrf=[\w-]{43}; Path=\/; Secure; SameSite=Lax$/);
    const token = 'e'.repeat(43);
    const ok = await custom.inject({ method: 'POST', url: '/c/write', headers: { cookie: `xsrf=${token}`, 'x-xsrf': token } });
    assert.equal(ok.status, 200);
    assert.throws(() => csrf({ token: { cookie: { secure: false } } }), /__Host-/);
  });
});

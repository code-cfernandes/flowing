import assert from 'node:assert/strict';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { type Context, createApp, Get, Router } from 'sashiko';
import { isValidHost, parseRequestTarget, pickForwarded } from '../../src/utils/request-target.ts';

@Router('/')
class Echo {
  @Get('/*') any(ctx: Context) {
    return { path: ctx.path, host: ctx.host, hostname: ctx.hostname, protocol: ctx.protocol, ip: ctx.ip, href: ctx.url.href };
  }
}

/** Envia uma requisição HTTP crua, sem a normalização que o fetch faria. */
function raw(port: number, request: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    let data = '';
    sock.on('data', (c) => (data += c));
    sock.on('end', () => {
      const [head = '', ...rest] = data.split('\r\n\r\n');
      resolve({ status: Number(head.split(' ')[1]), body: rest.join('\r\n\r\n') });
    });
    sock.on('error', reject);
    sock.write(request);
  });
}
const req = (path: string, headers: Record<string, string>) =>
  `GET ${path} HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\nConnection: close\r\n\r\n`;

describe('S-09 · Host e request-target (rede real)', () => {
  let port = 0;
  const app = createApp({ logger: false, shutdown: false }).mount(Echo);
  before(async () => { port = ((await app.listen(0)).address() as AddressInfo).port; });
  after(() => app.close());

  it('Host malformado responde 400, e não 500', async () => {
    const res = await raw(port, req('/a', { Host: 'a b' }));
    assert.equal(res.status, 400);
    assert.deepEqual(JSON.parse(res.body), { error: 'Invalid Host header' });
  });

  it('path "//evil.com/x" continua sendo esse path; o host não muda', async () => {
    const res = await raw(port, req('//evil.com/x', { Host: 'api.local' }));
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.path, '//evil.com/x');
    assert.equal(body.host, 'api.local');
    assert.equal(body.href, 'http://api.local//evil.com/x');
  });

  it('absolute-form (http://outro/x) só aproveita path e query', async () => {
    const res = await raw(port, req('http://evil.com/x?y=1', { Host: 'api.local' }));
    const body = JSON.parse(res.body);
    assert.deepEqual([body.path, body.host], ['/x', 'api.local']);
  });

  it('dot segments continuam normalizados', async () => {
    const body = JSON.parse((await raw(port, req('/a/../b', { Host: 'api.local' }))).body);
    assert.equal(body.path, '/b');
  });
});

describe('S-09 · trustProxy', () => {
  const headers = { 'x-forwarded-for': '203.0.113.7, 10.0.0.2', 'x-forwarded-host': 'public.exemplo.com', 'x-forwarded-proto': 'https' };

  it('desligado por padrão: headers X-Forwarded-* são ignorados', async () => {
    const app = createApp({ logger: false }).mount(Echo);
    const body = (await app.inject({ url: '/x', headers, remoteAddress: '10.0.0.9' })).json() as Record<string, string>;
    assert.deepEqual([body['ip'], body['host'], body['protocol']], ['10.0.0.9', 'localhost', 'http']);
  });

  it('true: confia em toda a cadeia (primeiro valor)', async () => {
    const app = createApp({ logger: false, trustProxy: true }).mount(Echo);
    const body = (await app.inject({ url: '/x', headers })).json() as Record<string, string>;
    assert.deepEqual([body['ip'], body['host'], body['protocol'], body['href']], ['203.0.113.7', 'public.exemplo.com', 'https', 'https://public.exemplo.com/x']);
  });

  it('número: confia só nos N proxies mais próximos', async () => {
    const app = createApp({ logger: false, trustProxy: 1 }).mount(Echo);
    // O cliente forjou o primeiro valor; só o adicionado pelo nosso proxy (o último) é confiável.
    const body = (await app.inject({ url: '/x', headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' } })).json() as Record<string, string>;
    assert.equal(body['ip'], '203.0.113.7');
  });

  it('X-Forwarded-Host inválido com trustProxy → 400', async () => {
    const app = createApp({ logger: false, trustProxy: true }).mount(Echo);
    assert.equal((await app.inject({ url: '/x', headers: { 'x-forwarded-host': 'a b' } })).status, 400);
  });
});

describe('S-09 · allowedHosts', () => {
  const app = createApp({ logger: false, allowedHosts: ['api.exemplo.com', '*.exemplo.dev', /^ci-\d+\.exemplo\.net$/] }).mount(Echo);
  const status = async (host: string) => (await app.inject({ url: '/x', headers: { host } })).status;

  it('aceita hosts da lista (com ou sem porta, sem diferenciar maiúsculas), curinga e RegExp', async () => {
    assert.equal(await status('api.exemplo.com'), 200);
    assert.equal(await status('API.exemplo.com:8443'), 200);
    assert.equal(await status('preview.exemplo.dev'), 200);
    assert.equal(await status('ci-42.exemplo.net'), 200);
  });

  it('curinga e RegExp não aceitam variações de prefixo ou sufixo', async () => {
    assert.equal(await status('exemplo.dev'), 400, 'curinga não inclui o domínio em si');
    assert.equal(await status('exemplo.dev.atacante.com'), 400);
    assert.equal(await status('ci-42.exemplo.net.atacante.com'), 400, 'RegExp precisa casar o hostname inteiro');
  });

  it('recusa hosts fora da lista com 400, já com os headers de segurança', async () => {
    const res = await app.inject({ url: '/x', headers: { host: 'evil.com' } });
    assert.equal(res.status, 400);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });

  it('não falha em requisições consecutivas com RegExp contendo flags g ou y (lastIndex)', async () => {
    const appWithFlags = createApp({
      logger: false,
      allowedHosts: [/api\.exemplo\.com/g, /preview\.exemplo\.dev/y],
    }).mount(Echo);

    for (let i = 0; i < 3; i++) {
      const resG = await appWithFlags.inject({ url: '/x', headers: { host: 'api.exemplo.com' } });
      assert.equal(resG.status, 200, `tentativa ${i + 1} para flag g`);

      const resY = await appWithFlags.inject({ url: '/x', headers: { host: 'preview.exemplo.dev' } });
      assert.equal(resY.status, 200, `tentativa ${i + 1} para flag y`);
    }
  });
});

describe('S-09 · utilitários', () => {
  it('isValidHost', () => {
    for (const ok of ['localhost', 'api.exemplo.com', 'a-b.c:8080', '127.0.0.1:3000', '[::1]', '[2001:db8::1]:443']) assert.equal(isValidHost(ok), true, ok);
    for (const no of [undefined, '', 'a b', 'evil.com/x', 'a@b', '-a.com', 'a.com:', 'a.com:123456', 'exemplo.com\r\nX: y']) assert.equal(isValidHost(no), false, String(no));
  });

  it('parseRequestTarget', () => {
    assert.equal(parseRequestTarget('//evil.com/x?a=1').href, 'http://localhost//evil.com/x?a=1');
    assert.equal(parseRequestTarget('https://evil.com/p?q').href, 'http://localhost/p?q');
    assert.equal(parseRequestTarget(undefined).pathname, '/');
    assert.equal(parseRequestTarget('*').pathname, '/*');
  });

  it('pickForwarded', () => {
    assert.equal(pickForwarded('a, b, c', false), undefined);
    assert.equal(pickForwarded('a, b, c', true), 'a');
    assert.equal(pickForwarded('a, b, c', 1), 'c');
    assert.equal(pickForwarded('a, b, c', 2), 'b');
    assert.equal(pickForwarded('a, b, c', 10), 'a');
    assert.equal(pickForwarded(['a, b', 'c'], 1), 'c');
    assert.equal(pickForwarded(undefined, true), undefined);
  });
});

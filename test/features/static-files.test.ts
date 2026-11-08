import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { type Context, createApp, Get, Router } from 'flowingts';

const base = mkdtempSync(join(tmpdir(), 'flowing-static-'));
const root = join(base, 'public');
const secret = join(base, 'secret.txt');

before(() => {
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'empty'));
  writeFileSync(join(root, 'index.html'), '<h1>home</h1>');
  writeFileSync(join(root, 'app.js'), 'console.log(1)');
  writeFileSync(join(root, 'data.bin'), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  writeFileSync(join(root, 'vazio.txt'), '');
  writeFileSync(join(root, 'relatório final.txt'), 'texto');
  writeFileSync(join(root, '.env'), 'SECRET=1');
  writeFileSync(join(root, '.git', 'config'), '[core]');
  writeFileSync(join(root, 'docs', 'index.html'), '<h1>docs</h1>');
  writeFileSync(secret, 'segredo');
  symlinkSync(secret, join(root, 'fuga.txt'));
  utimesSync(join(root, 'app.js'), new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
});
after(() => rmSync(base, { recursive: true, force: true }));

describe('app.static()', () => {
  const app = () => createApp({ logger: false }).static('/assets', root, { maxAge: '1h' });

  it('serve arquivos com tipo, tamanho, cache e validadores', async () => {
    const res = await app().inject('/assets/app.js');
    assert.equal(res.status, 200);
    assert.equal(res.body, 'console.log(1)');
    assert.equal(res.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(res.headers['content-length'], '14');
    assert.equal(res.headers['cache-control'], 'public, max-age=3600');
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.match(String(res.headers.etag), /^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    assert.equal(res.headers['last-modified'], 'Thu, 01 Jan 2026 00:00:00 GMT');
  });

  it('índice de diretório, sem listar diretórios sem índice', async () => {
    assert.equal((await app().inject('/assets/')).body, '<h1>home</h1>');
    assert.equal((await app().inject('/assets/docs')).body, '<h1>docs</h1>');
    assert.equal((await app().inject('/assets/empty')).status, 404);
    const noIndex = createApp({ logger: false }).static('/a', root, { index: false });
    assert.equal((await noIndex.inject('/a/docs')).status, 404);
  });

  it('nomes com espaço e acento (URL codificada)', async () => {
    const res = await app().inject(`/assets/${encodeURIComponent('relatório final.txt')}`);
    assert.equal(res.status, 200);
    assert.equal(res.body, 'texto');
  });

  it('path traversal, symlink para fora da raiz e arquivos ocultos respondem 404', async () => {
    for (const url of [
      '/assets/../secret.txt',
      '/assets/%2e%2e/secret.txt',
      '/assets/docs/%2e%2e/%2e%2e/secret.txt',
      '/assets/..%2fsecret.txt',
      '/assets/..%5csecret.txt',
      '/assets/app.js%00.png',
      '/assets/fuga.txt',
      '/assets/.env',
      '/assets/.git/config',
      '/assets/inexistente.js',
    ]) {
      const res = await app().inject(url);
      assert.equal(res.status, 404, url);
      assert.ok(!res.body.includes('segredo') && !res.body.includes('SECRET'), url);
    }
    const allow = createApp({ logger: false }).static('/a', root, { dotfiles: 'allow' });
    assert.equal((await allow.inject('/a/.env')).body, 'SECRET=1');
  });

  it('304 por If-None-Match e por If-Modified-Since', async () => {
    const a = app();
    const first = await a.inject('/assets/app.js');
    const byEtag = await a.inject({ url: '/assets/app.js', headers: { 'if-none-match': String(first.headers.etag) } });
    assert.equal(byEtag.status, 304);
    assert.equal(byEtag.body, '');
    const byDate = await a.inject({ url: '/assets/app.js', headers: { 'if-modified-since': 'Fri, 02 Jan 2026 00:00:00 GMT' } });
    assert.equal(byDate.status, 304);
    const stale = await a.inject({
      url: '/assets/app.js',
      headers: { 'if-none-match': 'W/"outro"', 'if-modified-since': 'Fri, 02 Jan 2026 00:00:00 GMT' },
    });
    assert.equal(stale.status, 200, 'If-None-Match prevalece');
  });

  it('Range: 206 com Content-Range, sufixo, 416 fora do arquivo, e If-Range', async () => {
    const a = app();
    const part = await a.inject({ url: '/assets/data.bin', headers: { range: 'bytes=2-4' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers['content-range'], 'bytes 2-4/10');
    assert.equal(part.headers['content-length'], '3');
    const suffix = await a.inject({ url: '/assets/data.bin', headers: { range: 'bytes=-3' } });
    assert.equal(suffix.headers['content-range'], 'bytes 7-9/10');
    const open = await a.inject({ url: '/assets/data.bin', headers: { range: 'bytes=8-' } });
    assert.equal(open.headers['content-range'], 'bytes 8-9/10');
    const bad = await a.inject({ url: '/assets/data.bin', headers: { range: 'bytes=20-30' } });
    assert.equal(bad.status, 416);
    assert.equal(bad.headers['content-range'], 'bytes */10');
    const multi = await a.inject({ url: '/assets/data.bin', headers: { range: 'bytes=0-1,4-5' } });
    assert.equal(multi.status, 200, 'vários intervalos: arquivo inteiro');
    const changed = await a.inject({ url: '/assets/data.bin', headers: { range: 'bytes=0-1', 'if-range': 'W/"outro"' } });
    assert.equal(changed.status, 200, 'If-Range diferente: arquivo inteiro');
  });

  it('HEAD sem corpo; arquivo vazio; POST responde 405', async () => {
    const head = await app().inject({ method: 'HEAD', url: '/assets/app.js' });
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    assert.equal(head.headers['content-length'], '14');
    const empty = await app().inject('/assets/vazio.txt');
    assert.equal(empty.status, 200);
    assert.equal(empty.headers['content-length'], '0');
    assert.equal((await app().inject({ method: 'POST', url: '/assets/app.js' })).status, 405);
  });

  it('SPA: fallback só para paths sem extensão, com no-cache', async () => {
    const spa = createApp({ logger: false }).static('/', root, { fallback: 'index.html' });
    const route = await spa.inject('/pedidos/42');
    assert.equal(route.body, '<h1>home</h1>');
    assert.equal(route.headers['cache-control'], 'no-cache');
    assert.equal((await spa.inject('/sumiu.js')).status, 404);
    assert.equal((await spa.inject('/../secret.txt')).status, 404, 'traversal não cai no fallback');
  });

  it('dentro de group(): herda prefixo, host e guards; fica fora do OpenAPI', async () => {
    const a = createApp({ logger: false })
      .group({ prefix: '/v1', host: 'cdn.exemplo.com', guards: [(ctx) => ctx.get('x-key') === 'ok'] }, (g) => g.static('/files', root))
      .openapi();
    const at = (headers: Record<string, string>) => a.inject({ url: '/v1/files/app.js', headers: { host: 'cdn.exemplo.com', ...headers } });
    assert.equal((await at({ 'x-key': 'ok' })).status, 200);
    assert.equal((await at({})).status, 403);
    assert.equal((await a.inject({ url: '/v1/files/app.js', headers: { host: 'outro.dev', 'x-key': 'ok' } })).status, 404);
    assert.deepEqual(Object.keys((a.openapiDocument({ host: 'cdn.exemplo.com' }) as { paths: object }).paths), []);
  });

  it('configuração inválida falha na hora', () => {
    assert.throws(() => createApp().static('/a', join(base, 'nao-existe')), /does not exist/);
    assert.throws(() => createApp().static('/a', join(root, 'app.js')), /not a directory/);
    assert.throws(() => createApp().static('/a', root, { maxAge: '1 semana' }), /invalid maxAge/);
  });

  it('em rede real, o arquivo chega inteiro e com o Range certo', async () => {
    const a = createApp({ logger: false, shutdown: false }).static('/s', root);
    const server = await a.listen(0);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      assert.deepEqual([...new Uint8Array(await (await fetch(`${url}/s/data.bin`)).arrayBuffer())], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      assert.deepEqual(
        [...new Uint8Array(await (await fetch(`${url}/s/data.bin`, { headers: { range: 'bytes=3-5' } })).arrayBuffer())],
        [3, 4, 5],
      );
    } finally {
      await a.close();
    }
  });
});

describe('ctx.sendFile()', () => {
  @Router('/')
  class Files {
    @Get('/rel/:name') rel(ctx: Context<'/rel/:name'>) {
      return ctx.sendFile(ctx.params.name, { root });
    }
    @Get('/abs') abs(ctx: Context) {
      return ctx.sendFile(join(root, 'app.js'), { download: 'código.js' });
    }
    @Get('/bad') bad(ctx: Context) {
      return ctx.sendFile('app.js');
    }
  }
  const app = createApp({ logger: false }).mount(Files);

  it('com root: relativo e sem sair da raiz', async () => {
    assert.equal((await app.inject('/rel/app.js')).body, 'console.log(1)');
    assert.equal((await app.inject(`/rel/${encodeURIComponent('../secret.txt')}`)).status, 404);
    assert.equal((await app.inject('/rel/.env')).status, 404);
  });

  it('download com nome UTF-8 no Content-Disposition', async () => {
    const res = await app.inject('/abs');
    assert.equal(res.headers['content-disposition'], `attachment; filename="c_digo.js"; filename*=UTF-8''c%C3%B3digo.js`);
  });

  it('sem root, o path precisa ser absoluto', async () => {
    assert.equal((await app.inject('/bad')).status, 500);
  });
});

describe('0.12.1 · Range conforme a RFC 9110', () => {
  const app = () => createApp({ logger: false }).static('/s', root);

  it('If-Range com ETag (fraco) nunca autoriza resposta parcial; data só se for exata', async () => {
    const a = app();
    const full = await a.inject('/s/data.bin');
    const weak = await a.inject({ url: '/s/data.bin', headers: { range: 'bytes=0-1', 'if-range': String(full.headers.etag) } });
    assert.equal(weak.status, 200);
    const exact = await a.inject({
      url: '/s/data.bin',
      headers: { range: 'bytes=0-1', 'if-range': String(full.headers['last-modified']) },
    });
    assert.equal(exact.status, 206);
    const later = new Date(Date.parse(String(full.headers['last-modified'])) + 60_000).toUTCString();
    assert.equal(
      (await a.inject({ url: '/s/data.bin', headers: { range: 'bytes=0-1', 'if-range': later } })).status,
      200,
      'data posterior não vale',
    );
  });

  it('Range é ignorado em HEAD e com unidade desconhecida', async () => {
    const head = await app().inject({ method: 'HEAD', url: '/s/data.bin', headers: { range: 'bytes=0-1' } });
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-length'], '10');
    for (const range of ['items=0-1', 'bytes=abc', 'bytes=0-1,4-5']) {
      assert.equal((await app().inject({ url: '/s/data.bin', headers: { range } })).status, 200, range);
    }
    assert.equal(
      (await app().inject({ url: '/s/data.bin', headers: { range: 'bytes=50-' } })).status,
      416,
      'bytes fora do arquivo continua 416',
    );
  });

  it('static() a partir do retorno de mount() fica no mesmo escopo', async () => {
    @Router('/')
    class R {
      @Get('/x') x() {
        return 'x';
      }
    }
    const a = createApp({ logger: false }).mount(R).static('/s', root);
    assert.equal((await a.inject('/s/app.js')).status, 200);
    const inGroup = createApp({ logger: false }).group({ prefix: '/g' }, (g) => g.mount(R).static('/s', root));
    assert.equal((await inGroup.inject('/g/s/app.js')).status, 200);
  });
});

describe('0.12.2 · sendFile depois do envio', () => {
  it('um segundo sendFile é ignorado, sem alterar os headers da resposta em andamento', async () => {
    @Router('/')
    class Twice {
      @Get('/t') async t(ctx: Context) {
        await ctx.sendFile('app.js', { root });
        await ctx.sendFile('data.bin', { root, download: true });
      }
    }
    const res = await createApp({ logger: false }).mount(Twice).inject('/t');
    assert.equal(res.body, 'console.log(1)');
    assert.equal(res.headers['content-disposition'], undefined);
  });
});

import { Type } from '@sinclair/typebox';
import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, describe, it } from 'node:test';
import {
  type Context, Router, cors, createApp, Get, MemoryRateLimitStore, Post, rateLimit, Schema, timer,
} from 'sashiko';
import { startServer, type TestServer } from '../helpers/server.ts';

@Router('/api')
class Api {
  @Get('/data') data() { return { ok: true }; }
  @Post('/data') save(ctx: Context) { return ctx.body; }
}

describe('S-04 / S-02 · headers de segurança', () => {
  let srv: TestServer;
  before(async () => { srv = await startServer(createApp().mount(Api)); });
  after(() => srv.close());

  it('aplica os headers padrão em respostas de sucesso', async () => {
    const h = (await fetch(srv.url + '/api/data')).headers;
    assert.equal(h.get('x-content-type-options'), 'nosniff');
    assert.equal(h.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");
    assert.equal(h.get('referrer-policy'), 'no-referrer');
    assert.equal(h.get('x-frame-options'), 'DENY');
    assert.equal(h.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(h.get('strict-transport-security'), null, 'HSTS é opt-in');
    assert.equal(h.get('x-powered-by'), null);
  });

  it('aplica também em 404 e em erros', async () => {
    const res = await fetch(srv.url + '/nada');
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  it('é configurável e pode ser desligado', async () => {
    const custom = await startServer(
      createApp({ securityHeaders: { frameOptions: 'SAMEORIGIN', strictTransportSecurity: true } }).mount(Api),
    );
    const off = await startServer(createApp({ securityHeaders: false }).mount(Api));
    try {
      const h1 = (await fetch(custom.url + '/api/data')).headers;
      assert.equal(h1.get('x-frame-options'), 'SAMEORIGIN');
      assert.equal(h1.get('strict-transport-security'), 'max-age=15552000; includeSubDomains');
      const h2 = (await fetch(off.url + '/api/data')).headers;
      assert.equal(h2.get('x-content-type-options'), null);
    } finally {
      await custom.close();
      await off.close();
    }
  });
});

describe('F-08 · HEAD e OPTIONS automáticos', () => {
  let srv: TestServer;
  before(async () => { srv = await startServer(createApp().mount(Api)); });
  after(() => srv.close());

  it('HEAD usa o handler do GET sem corpo', async () => {
    const res = await fetch(srv.url + '/api/data', { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '');
  });

  it('OPTIONS responde 204 com Allow', async () => {
    const res = await fetch(srv.url + '/api/data', { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('allow'), 'GET, HEAD, OPTIONS, POST');
  });

  it('OPTIONS em path inexistente continua 404', async () => {
    assert.equal((await fetch(srv.url + '/nada', { method: 'OPTIONS' })).status, 404);
  });
});

describe('S-01 · CORS', () => {
  let srv: TestServer;
  before(async () => {
    const app = createApp()
      .use(cors({ origin: ['https://app.exemplo.com', 'https://*.exemplo.dev'], credentials: true, exposedHeaders: ['X-Total'] }))
      .mount(Api);
    srv = await startServer(app);
  });
  after(() => srv.close());

  const preflight = (origin: string) =>
    fetch(srv.url + '/api/data', {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, x-evil' },
    });

  it('preflight de origem permitida responde 204 com os headers CORS', async () => {
    const res = await preflight('https://app.exemplo.com');
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.exemplo.com');
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    assert.match(res.headers.get('access-control-allow-methods')!, /POST/);
    assert.equal(res.headers.get('access-control-allow-headers'), 'content-type', 'headers não padrão são filtrados');
    assert.equal(res.headers.get('access-control-max-age'), '600');
    assert.match(res.headers.get('vary')!, /Origin/);
  });

  it('origem por curinga de subdomínio é aceita', async () => {
    const res = await preflight('https://preview.exemplo.dev');
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://preview.exemplo.dev');
  });

  it('não falha em requisições consecutivas quando origin usa RegExp com flags g ou y (lastIndex)', async () => {
    const s = await startServer(
      createApp()
        .use(cors({ origin: [/https:\/\/app\.exemplo\.com/g, /https:\/\/preview\.exemplo\.dev/y] }))
        .mount(Api),
    );
    try {
      for (let i = 0; i < 3; i++) {
        const resG = await fetch(s.url + '/api/data', { headers: { origin: 'https://app.exemplo.com' } });
        assert.equal(resG.headers.get('access-control-allow-origin'), 'https://app.exemplo.com', `tentativa ${i + 1} para flag g`);

        const resY = await fetch(s.url + '/api/data', { headers: { origin: 'https://preview.exemplo.dev' } });
        assert.equal(resY.headers.get('access-control-allow-origin'), 'https://preview.exemplo.dev', `tentativa ${i + 1} para flag y`);
      }
    } finally {
      await s.close();
    }
  });

  it('origem não permitida não recebe Allow-Origin', async () => {
    const res = await preflight('https://atacante.com');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
  });

  it('requisição real recebe Allow-Origin e Expose-Headers', async () => {
    const res = await fetch(srv.url + '/api/data', { headers: { origin: 'https://app.exemplo.com' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.exemplo.com');
    assert.equal(res.headers.get('access-control-expose-headers'), 'X-Total');
  });

  it("rejeita origin '*' com credentials na criação", () => {
    assert.throws(() => cors({ origin: '*', credentials: true }), /cannot be combined/);
  });

  it("origin '*' responde com * e sem Vary", async () => {
    const s = await startServer(createApp().use(cors({ origin: '*' })).mount(Api));
    try {
      const res = await fetch(s.url + '/api/data', { headers: { origin: 'https://qualquer.com' } });
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      assert.equal(res.headers.get('vary'), null);
    } finally {
      await s.close();
    }
  });
});

describe('S-06 · DoS', () => {
  it('rate limit responde 429 com Retry-After após exceder', async () => {
    const s = await startServer(
      createApp().use(rateLimit({ max: 2, windowMs: 60_000, store: new MemoryRateLimitStore() })).mount(Api),
    );
    try {
      const statuses = [];
      for (let i = 0; i < 3; i++) statuses.push((await fetch(s.url + '/api/data')).status);
      assert.deepEqual(statuses, [200, 200, 429]);
      const res = await fetch(s.url + '/api/data');
      assert.ok(Number(res.headers.get('retry-after')) > 0);
      assert.equal(res.headers.get('ratelimit-limit'), '2');
    } finally {
      await s.close();
    }
  });

  it('B-12 · Content-Length acima do limite é rejeitado antes de ler o corpo e fecha a conexão', async () => {
    const s = await startServer(createApp({ bodyLimit: 100 }).mount(Api));
    try {
      const port = new URL(s.url).port;
      const raw = await new Promise<string>((resolve, reject) => {
        const sock = net.connect(Number(port), '127.0.0.1');
        let data = '';
        sock.on('data', (d) => (data += d));
        sock.on('end', () => resolve(data));
        sock.on('error', reject);
        // Anuncia 1 MB mas envia só o começo: a resposta deve chegar sem esperar o resto.
        sock.write('POST /api/data HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 1000000\r\n\r\n{"a":');
      });
      assert.match(raw, /^HTTP\/1\.1 413/);
      assert.match(raw, /connection: close/i);
    } finally {
      await s.close();
    }
  });

  it('aplica timeouts padrão no servidor', async () => {
    const app = createApp();
    const server = await app.listen(0);
    try {
      assert.equal(server.requestTimeout, 30_000);
      assert.equal(server.headersTimeout, 10_000);
      assert.equal(server.keepAliveTimeout, 5_000);
    } finally {
      await app.close();
    }
  });
});

describe('S-07 · requireSchemas', () => {
  it('falha no registro de POST sem body schema', () => {
    @Router('/x') class NoBody { @Post('/') @Schema({ response: { 200: Type.Object({}) } }) a() {} }
    assert.throws(() => createApp({ requireSchemas: true }).mount(NoBody), /no body schema/);
  });

  it('falha no registro de rota sem response schema', () => {
    @Router('/x') class NoResp { @Get('/') b() {} }
    assert.throws(() => createApp({ requireSchemas: true }).mount(NoResp), /no response schema/);
  });

  it('aceita rotas com schemas completos', () => {
    @Router('/x') class Ok {
      @Post('/') @Schema({ body: Type.Object({}), response: { 201: Type.Object({}) } }) c() {}
    }
    assert.doesNotThrow(() => createApp({ requireSchemas: true }).mount(Ok));
  });
});

describe('B-04 · timer', () => {
  it('mede handlers async incluindo o tempo aguardado', async () => {
    const measured: number[] = [];
    class T {
      @timer({ log: (_m, ms) => measured.push(ms) })
      async slow() { await new Promise((r) => setTimeout(r, 30)); return 'ok'; }
    }
    assert.equal(await new T().slow(), 'ok');
    assert.equal(measured.length, 1);
    assert.ok(measured[0]! >= 25, `mediu ${measured[0]}ms`);
  });

  it('mede mesmo quando o handler lança', () => {
    const measured: number[] = [];
    class T { @timer({ log: (_m, ms) => measured.push(ms) }) boom() { throw new Error('x'); } }
    assert.throws(() => new T().boom(), /x/);
    assert.equal(measured.length, 1);
  });
});

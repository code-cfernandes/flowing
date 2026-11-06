import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { basicAuth, bearerAuth, type Context, consoleLogger, createApp, DEFAULT_REDACT_KEYS, Get, Post, Router, safeEqual } from 'sashiko';
import { parseJson } from '../../src/utils/safe-json.ts';

@Router('/')
class Echo {
  @Post('/echo') echo(ctx: Context) {
    return { body: ctx.body, polluted: ({} as Record<string, unknown>).polluted ?? null };
  }
  @Get('/me') me(ctx: Context) {
    return { user: ctx.state.user ?? null };
  }
}

describe('S-08 · prototype pollution no body JSON', () => {
  const post = (app: ReturnType<typeof createApp>, raw: string) =>
    app.inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'application/json' }, body: raw });

  it('padrão: __proto__ em qualquer nível responde 400 PROTO_POISONING', async () => {
    const app = createApp({ logger: false }).mount(Echo).app;
    for (const raw of [
      '{"__proto__":{"polluted":true}}',
      '{"a":[{"b":{"__proto__":{"polluted":true}}}]}',
      '{"\\u005f_proto__":{"polluted":true}}',
      '{"constructor":{"prototype":{"polluted":true}}}',
    ]) {
      const res = await post(app, raw);
      assert.equal(res.status, 400, raw);
      assert.equal(res.json<{ code: string }>().code, 'PROTO_POISONING');
    }
  });

  it("protoPoisoning: 'remove' descarta as chaves e segue", async () => {
    const app = createApp({ logger: false, protoPoisoning: 'remove' }).mount(Echo).app;
    const res = await post(app, '{"name":"Ana","__proto__":{"polluted":true},"nested":{"constructor":{"prototype":{}}}}');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { body: { name: 'Ana', nested: {} }, polluted: null });
  });

  it('"constructor" comum e palavras parecidas continuam aceitos', async () => {
    const app = createApp({ logger: false }).mount(Echo).app;
    const res = await post(app, '{"constructor":"Ana","protocol":"https","proto":1,"emoji":"\\u00e9"}');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json<{ body: unknown }>().body, { constructor: 'Ana', protocol: 'https', proto: 1, emoji: 'é' });
  });

  it('parseJson: caminho rápido sem as chaves suspeitas', () => {
    assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
    assert.equal(parseJson('null'), null);
    assert.throws(() => parseJson('{"__proto__":1}'), /forbidden key "__proto__"/);
  });
});

describe('S-11 · logs sem dados sensíveis', () => {
  it('mascara as chaves padrão em qualquer nível, ignorando maiúsculas, - e _', () => {
    const info = mock.method(console, 'info', () => {});
    try {
      consoleLogger().info(
        {
          headers: { Authorization: 'Bearer x', Cookie: 'sid=1', 'X-Api-Key': 'k' },
          user: { name: 'Ana', password: 'p', apiKey: 'k2', tokens: [{ access_token: 't' }] },
        },
        'msg',
      );
      assert.deepEqual(info.mock.calls[0]!.arguments[1], {
        headers: { Authorization: '[REDACTED]', Cookie: '[REDACTED]', 'X-Api-Key': '[REDACTED]' },
        user: { name: 'Ana', password: '[REDACTED]', apiKey: '[REDACTED]', tokens: [{ access_token: '[REDACTED]' }] },
      });
    } finally {
      info.mock.restore();
    }
  });

  it('chaves extras, bindings do child, ciclos e erros preservados', () => {
    const warn = mock.method(console, 'warn', () => {});
    try {
      const err = new Error('boom');
      const cyclic: Record<string, unknown> = { cpf: '123' };
      cyclic.self = cyclic;
      consoleLogger({ redact: ['cpf'] })
        .child({ token: 'bound' })
        .warn({ err, data: cyclic }, 'msg');
      const logged = warn.mock.calls[0]!.arguments[1] as Record<string, any>;
      assert.equal(logged.token, '[REDACTED]');
      assert.equal(logged.err, err);
      assert.deepEqual(logged.data, { cpf: '[REDACTED]', self: '[Circular]' });
    } finally {
      warn.mock.restore();
    }
  });

  it('redact: false desliga', () => {
    const info = mock.method(console, 'info', () => {});
    try {
      consoleLogger({ redact: false }).info({ password: 'p' });
      assert.deepEqual(info.mock.calls[0]!.arguments[1], { password: 'p' });
      assert.ok(DEFAULT_REDACT_KEYS.includes('authorization'));
    } finally {
      info.mock.restore();
    }
  });
});

describe('S-10 · guards de autenticação', () => {
  const users = new Map([['tok-ana', { id: '1', role: 'admin' as const }]]);

  it('bearerAuth: token válido passa e preenche ctx.state.user; o resto recebe o mesmo 401', async () => {
    const app = createApp({ logger: false }).group({ guards: [bearerAuth({ verify: (t) => users.get(t) })] }, (g) => g.mount(Echo));
    const ok = await app.inject({ url: '/me', headers: { authorization: 'bearer tok-ana' } });
    assert.deepEqual(ok.json(), { user: { id: '1', role: 'admin' } });

    for (const authorization of [undefined, 'Bearer', 'Bearer   ', 'Basic dG9rLWFuYQ==', 'Bearer errado']) {
      const res = await app.inject({ url: '/me', headers: authorization ? { authorization } : {} });
      assert.equal(res.status, 401, String(authorization));
      assert.equal(res.headers['www-authenticate'], 'Bearer realm="api"');
      assert.deepEqual(res.json(), { type: 'about:blank', title: 'Unauthorized', status: 401, code: 'UNAUTHORIZED' });
    }
  });

  it('verify assíncrono que devolve true não altera ctx.state.user', async () => {
    const app = createApp({ logger: false }).group(
      { guards: [bearerAuth({ verify: async (t) => safeEqual(t, 'segredo'), realm: 'a"b' })] },
      (g) => g.mount(Echo),
    );
    assert.deepEqual((await app.inject({ url: '/me', headers: { authorization: 'Bearer segredo' } })).json(), { user: null });
    const denied = await app.inject({ url: '/me', headers: { authorization: 'Bearer outro' } });
    assert.equal(denied.headers['www-authenticate'], 'Bearer realm="ab"', 'aspas removidas do realm');
  });

  it('basicAuth: usuário e senha, senha com ":", e 401 com charset', async () => {
    const guard = basicAuth({
      verify: (u, p) => (safeEqual(u, 'admin') && safeEqual(p, 'a:b') ? { id: 'admin' } : false),
      realm: 'painel',
    });
    const app = createApp({ logger: false }).group({ guards: [guard] }, (g) => g.mount(Echo));
    const basic = (s: string) => `Basic ${Buffer.from(s).toString('base64')}`;
    assert.deepEqual((await app.inject({ url: '/me', headers: { authorization: basic('admin:a:b') } })).json(), { user: { id: 'admin' } });
    for (const authorization of [basic('admin:errada'), basic('semdoispontos'), 'Basic', 'Bearer x']) {
      const res = await app.inject({ url: '/me', headers: { authorization } });
      assert.equal(res.status, 401);
      assert.equal(res.headers['www-authenticate'], 'Basic realm="painel", charset="UTF-8"');
    }
  });

  it('safeEqual', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual('', ''), true);
  });
});

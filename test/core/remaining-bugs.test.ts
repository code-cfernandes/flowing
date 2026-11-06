import { Type } from '@sinclair/typebox';
import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';
import { type Context, Router, createApp, Get, Post, Schema } from 'sashiko';
import { startServer, type TestServer } from '../helpers/server.ts';

const Pub = Type.Object({ id: Type.String() });

describe('B-05 · status x schema de resposta', () => {
  @Router('/b05')
  class C {
    // Só declara 201 e esquece ctx.status(201)
    @Post('/created')
    @Schema({ body: Type.Object({}), response: { 201: Pub } })
    created() {
      return { id: '1', password: 'hash' };
    }

    // Status explícito sem schema correspondente, com outros schemas declarados
    @Get('/mismatch')
    @Schema({ response: { 200: Pub } })
    mismatch(ctx: Context) {
      ctx.status(202);
      return { id: '1', password: 'hash' };
    }

    // 204 sem corpo não precisa de schema
    @Get('/empty')
    @Schema({ response: { 200: Pub } })
    empty(ctx: Context) {
      ctx.status(204);
    }

    // Sem nenhum schema de resposta: comportamento livre (JSON.stringify)
    @Get('/free') free() {
      return { any: 'thing' };
    }
  }

  let srv: TestServer;
  const errorLog = mock.method(console, 'error', () => {});
  before(async () => {
    srv = await startServer(createApp().mount(C));
  });
  after(async () => {
    errorLog.mock.restore();
    await srv.close();
  });

  it('usa o único 2xx declarado como status padrão e filtra os campos', async () => {
    const res = await fetch(srv.url + '/b05/created', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { id: '1' });
  });

  it('status sem schema correspondente não vaza o objeto: 500 + log', async () => {
    errorLog.mock.resetCalls();
    const res = await fetch(srv.url + '/b05/mismatch');
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.doesNotMatch(text, /password/);
    assert.equal(errorLog.mock.callCount(), 1);
    const data = errorLog.mock.calls[0]!.arguments[1] as { err: Error };
    assert.match(data.err.message, /no response schema for status 202/);
  });

  it('resposta sem corpo dispensa schema', async () => {
    assert.equal((await fetch(srv.url + '/b05/empty')).status, 204);
  });

  it('rotas sem schema de resposta continuam livres', async () => {
    assert.deepEqual(await (await fetch(srv.url + '/b05/free')).json(), { any: 'thing' });
  });
});

describe('B-07 · query com chaves repetidas', () => {
  @Router('/b07')
  class C {
    @Get('/raw') raw(ctx: Context) {
      return ctx.query;
    }

    @Get('/typed')
    @Schema({ query: Type.Object({ tag: Type.Array(Type.String()), page: Type.Integer() }) })
    typed(ctx: Context) {
      return ctx.query;
    }
  }

  let srv: TestServer;
  before(async () => {
    srv = await startServer(createApp().mount(C));
  });
  after(() => srv.close());

  it('chave repetida vira array; chave única continua string', async () => {
    const res = await fetch(srv.url + '/b07/raw?tag=a&tag=b&page=1');
    assert.deepEqual(await res.json(), { tag: ['a', 'b'], page: '1' });
  });

  it('schema de array aceita valor único (coerção para array)', async () => {
    const res = await fetch(srv.url + '/b07/typed?tag=a&page=2');
    assert.deepEqual(await res.json(), { tag: ['a'], page: 2 });
  });

  it('chaves perigosas (__proto__, constructor, prototype) são descartadas', async () => {
    const res = await fetch(srv.url + '/b07/raw?__proto__=x&constructor=y&prototype=z&a=1');
    const json = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(json), ['a']);
  });
});

describe('B-10 · controllers com dependências', () => {
  class Repo {
    find() {
      return { id: 'from-repo' };
    }
  }

  @Router('/b10')
  class WithDeps {
    constructor(private readonly repo: Repo) {}
    @Get('/') get() {
      return this.repo.find();
    }
  }

  it('aceita uma instância já construída', async () => {
    const srv = await startServer(createApp().mount(new WithDeps(new Repo())));
    try {
      assert.deepEqual(await (await fetch(srv.url + '/b10')).json(), { id: 'from-repo' });
    } finally {
      await srv.close();
    }
  });

  it('instância de classe sem @Controller gera erro claro', () => {
    class Plain {}
    assert.throws(() => createApp().mount(new Plain()), /Plain is not decorated with @Router/);
  });
});

describe('B-11 · detecção de JSON pelo media type', () => {
  @Router('/b11')
  class C {
    @Post('/') echo(ctx: Context) {
      return { body: ctx.body ?? null };
    }
  }

  let srv: TestServer;
  before(async () => {
    srv = await startServer(createApp().mount(C));
  });
  after(() => srv.close());

  const send = async (ct: string) => {
    const res = await fetch(srv.url + '/b11', { method: 'POST', headers: { 'content-type': ct }, body: '{"a":1}' });
    return ((await res.json()) as { body: unknown }).body;
  };

  it('aceita application/json com parâmetros e em maiúsculas', async () => {
    assert.deepEqual(await send('application/json; charset=utf-8'), { a: 1 });
    assert.deepEqual(await send('Application/JSON'), { a: 1 });
  });

  it('aceita sufixo +json (ex.: problem+json, merge-patch+json)', async () => {
    assert.deepEqual(await send('application/merge-patch+json'), { a: 1 });
  });

  it('ignora tipos que só contêm "application/json" como substring', async () => {
    assert.equal(await send('application/jsonx'), null);
    assert.equal(await send('text/plain; x=application/json'), null);
  });
});

describe('S-06 · queryMaxKeys', () => {
  @Router('/qk')
  class C {
    @Get('/') raw(ctx: Context) {
      return ctx.query;
    }
  }

  it('limita os pares lidos da query conforme AppOptions', async () => {
    const srv = await startServer(createApp({ queryMaxKeys: 2 }).mount(C));
    try {
      const res = await fetch(srv.url + '/qk?a=1&b=2&c=3');
      assert.deepEqual(await res.json(), { a: '1', b: '2' });
    } finally {
      await srv.close();
    }
  });
});

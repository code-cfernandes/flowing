import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import qs from 'qs';
import { type Context, createApp, Get, Router, type RouteSchemas, Type } from 'flowingts';

const list = {
  query: Type.Object({
    filter: Type.Object({ status: Type.Union([Type.Literal('ativo'), Type.Literal('inativo')]) }),
    sort: Type.Optional(Type.Array(Type.String(), { maxItems: 3 })),
  }),
  response: { 200: Type.Object({ filter: Type.Unknown(), sort: Type.Optional(Type.Array(Type.String())) }) },
} satisfies RouteSchemas;

@Router('/membros')
class Membros {
  @Get('/', list) list(ctx: Context<typeof list>) {
    return { filter: ctx.query.filter, sort: ctx.query.sort };
  }
  @Get('/raw') raw(ctx: Context) {
    return { query: ctx.query, protoIntact: ({} as Record<string, unknown>).polluted === undefined };
  }
}

const withQs = () => {
  const app = createApp({ logger: false, shutdown: false, queryParser: (raw) => qs.parse(raw, { depth: 3, arrayLimit: 50 }) });
  app.mount(Membros);
  return app;
};

describe('F-26 · queryParser', () => {
  it('query aninhada com qs chega em ctx.query e é validada pelo contrato', async () => {
    const ok = await withQs().inject('/membros?filter[status]=ativo&sort[]=nome&sort[]=idade');
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json(), { filter: { status: 'ativo' }, sort: ['nome', 'idade'] });
    const bad = await withQs().inject('/membros?filter[status]=talvez');
    assert.equal(bad.status, 400, 'o contrato valida o objeto aninhado');
  });

  it('chaves perigosas são removidas em qualquer nível, mesmo que o parser as deixe passar', async () => {
    const app = createApp({
      logger: false,
      shutdown: false,
      queryParser: (raw) => qs.parse(raw, { allowPrototypes: true, depth: 5 }),
    });
    app.mount(Membros);
    const res = await app.inject('/membros/raw?a[__proto__][polluted]=1&a[constructor][prototype][x]=1&b[c][prototype]=2&ok=1');
    const body = res.json<{ query: Record<string, unknown>; protoIntact: boolean }>();
    assert.equal(res.status, 200);
    assert.equal(body.protoIntact, true);
    assert.deepEqual(body.query, { a: {}, b: { c: {} }, ok: '1' });
  });

  it('parser que lança: 400 sem vazar a mensagem; retorno que não é objeto também', async () => {
    const throwing = createApp({
      logger: false,
      shutdown: false,
      queryParser: () => {
        throw new Error('detalhe interno: /srv/app/segredo');
      },
    });
    throwing.mount(Membros);
    const r = await throwing.inject('/membros/raw?x=1');
    assert.equal(r.status, 400);
    assert.equal(r.json<{ code: string }>().code, 'INVALID_QUERY');
    assert.doesNotMatch(r.body, /segredo|detalhe interno/);

    const arr = createApp({ logger: false, shutdown: false, queryParser: () => [] as never });
    arr.mount(Membros);
    assert.equal((await arr.inject('/membros/raw')).status, 400);
  });

  it('sem queryParser, nada muda: chaves repetidas viram array e a sintaxe aninhada é literal', async () => {
    const app = createApp({ logger: false, shutdown: false });
    app.mount(Membros);
    const res = await app.inject('/membros/raw?tag=a&tag=b&filter[status]=ativo');
    assert.deepEqual(res.json<{ query: unknown }>().query, { tag: ['a', 'b'], 'filter[status]': 'ativo' });
  });
});

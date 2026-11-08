import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type BodyParser, type Context, createApp, Post, Router, type RouteSchemas, Type } from 'flowingts';

const form: BodyParser = (raw) => Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
const contato = {
  body: Type.Object({ nome: Type.String({ minLength: 2 }), mensagem: Type.String() }, { additionalProperties: false }),
  response: { 200: Type.Object({ nome: Type.String(), mensagem: Type.String() }) },
} satisfies RouteSchemas;

@Router('/')
class R {
  @Post('/contato', contato) contato(ctx: Context<typeof contato>) {
    return ctx.body;
  }
  @Post('/raw') raw(ctx: Context) {
    return { body: ctx.body ?? null };
  }
}

function app(parsers: Record<string, BodyParser>, opts: Parameters<typeof createApp>[0] = {}) {
  const a = createApp({ logger: false, shutdown: false, parsers, ...opts });
  a.mount(R);
  return a;
}
const post = (a: ReturnType<typeof app>, url: string, type: string, body: string) =>
  a.inject({ method: 'POST', url, headers: { 'content-type': type }, body });

describe('F-12 · parsers de body', () => {
  it('formulário urlencoded vira ctx.body e é validado pelo contrato da rota', async () => {
    const a = app({ 'application/x-www-form-urlencoded': form });
    const ok = await post(a, '/contato', 'application/x-www-form-urlencoded; charset=utf-8', 'nome=Ana&mensagem=Ol%C3%A1');
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json(), { nome: 'Ana', mensagem: 'Olá' });
    const bad = await post(a, '/contato', 'application/x-www-form-urlencoded', 'nome=A&mensagem=x');
    assert.equal(bad.status, 400);
  });

  it('parser assíncrono e texto puro', async () => {
    const a = app({ 'text/plain': async (raw) => raw.toString('utf8').toUpperCase() });
    assert.deepEqual((await post(a, '/raw', 'text/plain', 'oi')).json(), { body: 'OI' });
  });

  it('parser que lança: 400 INVALID_BODY sem vazar a mensagem', async () => {
    const a = app({
      'application/yaml': () => {
        throw new Error('detalhe interno na linha 3');
      },
    });
    const r = await post(a, '/raw', 'application/yaml', 'a: [');
    assert.equal(r.status, 400);
    assert.equal(r.json<{ code: string }>().code, 'INVALID_BODY');
    assert.doesNotMatch(r.body, /detalhe interno/);
  });

  it('prototype pollution no resultado: 400 (ou removido, com protoPoisoning: remove); referência circular não trava', async () => {
    const poisoned: BodyParser = () => JSON.parse('{"a":{"__proto__":{"admin":true}}}');
    const r = await post(app({ 'application/x-test': poisoned }), '/raw', 'application/x-test', 'x');
    assert.equal(r.status, 400);
    assert.equal(r.json<{ code: string }>().code, 'PROTO_POISONING');
    const removed = await post(app({ 'application/x-test': poisoned }, { protoPoisoning: 'remove' }), '/raw', 'application/x-test', 'x');
    assert.deepEqual(removed.json(), { body: { a: {} } });

    const cyclic: BodyParser = () => {
      const node: Record<string, unknown> = { nome: 'loop' };
      node.self = node;
      return { ok: true, node };
    };
    const c = await post(app({ 'application/x-cycle': cyclic }), '/raw', 'application/x-cycle', 'x');
    assert.notEqual(c.status, 400, 'a checagem termina mesmo com referência circular');
  });

  it('bodyLimit vale para os parsers', async () => {
    const a = app({ 'text/plain': (raw) => raw.toString() }, { bodyLimit: 10 });
    assert.equal((await post(a, '/raw', 'text/plain', 'x'.repeat(50))).status, 413);
  });

  it('tipo sem parser: o corpo não é lido (fica disponível em ctx.req, como para o multer)', async () => {
    const a = app({ 'text/plain': (raw) => raw.toString() });
    assert.deepEqual((await post(a, '/raw', 'application/octet-stream', 'binário')).json(), { body: null });
  });

  it('configuração inválida falha na criação do app', () => {
    assert.throws(() => createApp({ parsers: { 'application/json': () => ({}) } }), /JSON, which the framework already parses/);
    assert.throws(() => createApp({ parsers: { 'application/vnd.api+json': () => ({}) } }), /JSON/);
    assert.throws(() => createApp({ parsers: { yaml: () => ({}) } }), /not a media type/);
  });
});

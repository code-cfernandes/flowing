import { Type } from '@sinclair/typebox';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it, mock } from 'node:test';
import { type Context, createApp, Get, type InferResponse, Router, type RouteSchemas } from 'sashiko';
import { negotiate } from '../../src/utils/content-type.ts';

const User = Type.Object({ id: Type.String(), name: Type.String() });
const users = [{ id: '1', name: 'Ana', password: 'hash' }];

// Serializador "de brinquedo" para o teste: sem dependências
const toCsv = (rows: unknown) =>
  (rows as Record<string, unknown>[]).map((r) => Object.values(r).join(',')).join('\n') + '\n';
const toYamlish = (data: unknown) => Object.entries(data as object).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n';

const csv = { response: { 200: { contentType: 'text/csv', schema: Type.String() } } } satisfies RouteSchemas;
const multi = { response: { 200: { contentType: ['application/json', 'text/csv'], schema: Type.Array(User) } } } satisfies RouteSchemas;
const yaml = { response: { 200: { contentType: 'application/yaml', schema: User } } } satisfies RouteSchemas;
const noSerializer = { response: { 200: { contentType: 'application/x-msgpack', schema: User } } } satisfies RouteSchemas;
const jsonString = { response: { 200: Type.String() } } satisfies RouteSchemas;

@Router('/f')
class Formats {
  // Sem schema: o tipo vem do valor retornado
  @Get('/text') text() { return 'olá'; }
  @Get('/bytes') bytes() { return Buffer.from([1, 2, 3]); }
  @Get('/stream') stream() { return Readable.from(['a', 'b', 'c']); }
  @Get('/object') object() { return { ok: true }; }
  @Get('/header') header(ctx: Context) { ctx.header('Content-Type', 'text/html; charset=utf-8'); return '<p>oi</p>'; }

  // Com contentType no schema
  @Get('/csv', csv) exportCsv() { return 'id,name\n1,Ana\n'; }
  @Get('/users', multi) list(): InferResponse<typeof multi> { return users; }
  @Get('/yaml', yaml) one() { return users[0]!; }
  @Get('/msgpack', noSerializer) msgpack() { return users[0]!; }
  @Get('/bad-yaml', yaml) bad() { return { id: 1 }; }

  // Schema JSON sem contentType: string continua sendo JSON
  @Get('/json-string', jsonString) js() { return 'olá'; }
}

const app = createApp({
  logger: false,
  serializers: { 'text/csv': toCsv, 'Application/YAML': toYamlish },
}).mount(Formats);

describe('F-31 · tipo de resposta pelo valor (rotas sem schema)', () => {
  it('string → text/plain, sem aspas', async () => {
    const res = await app.inject('/f/text');
    assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(res.body, 'olá');
  });

  it('Buffer → application/octet-stream', async () => {
    const res = await app.inject('/f/bytes');
    assert.equal(res.headers['content-type'], 'application/octet-stream');
    assert.equal(res.body, '\u0001\u0002\u0003');
  });

  it('stream → enviado em stream', async () => {
    const res = await app.inject('/f/stream');
    assert.equal(res.headers['content-type'], 'application/octet-stream');
    assert.equal(res.body, 'abc');
  });

  it('objeto → JSON, como antes', async () => {
    const res = await app.inject('/f/object');
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.deepEqual(res.json(), { ok: true });
  });

  it('o Content-Type definido pelo handler prevalece', async () => {
    const res = await app.inject('/f/header');
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(res.body, '<p>oi</p>');
  });
});

describe('F-31 · contentType no schema de resposta', () => {
  it('string com contentType text/csv sai crua, com charset', async () => {
    const res = await app.inject('/f/csv');
    assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal(res.body, 'id,name\n1,Ana\n');
  });

  it('schema JSON sem contentType mantém o comportamento: string vira JSON', async () => {
    const res = await app.inject('/f/json-string');
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(res.body, '"olá"');
  });

  it('serializador plugável recebe os dados já filtrados pelo schema (sem campos extras)', async () => {
    const res = await app.inject('/f/yaml');
    assert.equal(res.headers['content-type'], 'application/yaml; charset=utf-8');
    assert.equal(res.body, 'id: 1\nname: Ana\n');
    assert.doesNotMatch(res.body, /password/);
  });

  it('saída que não bate com o schema num formato não JSON → 500 com log', async () => {
    const errorLog = mock.method(console, 'error', () => {});
    const logged = createApp({ serializers: { 'application/yaml': toYamlish } }).mount(Formats);
    try {
      const res = await logged.inject('/f/bad-yaml');
      assert.equal(res.status, 500);
      const data = errorLog.mock.calls[0]!.arguments[1] as { err: Error };
      assert.match(data.err.message, /response does not match its schema/);
    } finally { errorLog.mock.restore(); }
  });

  it('tipo sem serializador registrado → 500 com instrução no log', async () => {
    const errorLog = mock.method(console, 'error', () => {});
    try {
      const res = await createApp().mount(Formats).inject('/f/msgpack');
      assert.equal(res.status, 500);
      const data = errorLog.mock.calls[0]!.arguments[1] as { err: Error };
      assert.match(data.err.message, /no serializer registered for "application\/x-msgpack"/);
    } finally { errorLog.mock.restore(); }
  });
});

describe('F-31 · negociação pelo Accept', () => {
  const get = (accept?: string) => app.inject({ url: '/f/users', headers: accept ? { accept } : {} });

  it('sem Accept usa o primeiro tipo declarado (JSON), filtrando campos', async () => {
    const res = await get();
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.deepEqual(res.json(), [{ id: '1', name: 'Ana' }]);
    assert.match(String(res.headers['vary']), /Accept/);
  });

  it('Accept text/csv escolhe CSV, também sem campos extras', async () => {
    const res = await get('text/csv');
    assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal(res.body, '1,Ana\n');
  });

  it('respeita q-values e curingas', async () => {
    assert.equal((await get('application/json;q=0.5, text/csv;q=0.9')).headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal((await get('text/*')).headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal((await get('*/*')).headers['content-type'], 'application/json; charset=utf-8');
  });

  it('nenhum tipo aceitável → 406 com os tipos disponíveis', async () => {
    const res = await get('application/xml');
    assert.equal(res.status, 406);
    assert.deepEqual(res.json(), { type: 'about:blank', title: 'Not Acceptable', status: 406, code: 'NOT_ACCEPTABLE', details: { available: ['application/json', 'text/csv'] } });
  });
});

describe('F-31 · negotiate()', () => {
  const offered = ['application/json', 'text/csv'];
  it('casos de borda', () => {
    assert.equal(negotiate(undefined, offered), 'application/json');
    assert.equal(negotiate('', offered), 'application/json');
    assert.equal(negotiate('text/csv;q=0, */*', offered), 'application/json', 'q=0 exclui');
    assert.equal(negotiate('TEXT/CSV', offered), 'text/csv', 'sem diferenciar maiúsculas');
    assert.equal(negotiate('text/*, text/csv;q=0.1', offered), 'text/csv');
    assert.equal(negotiate('image/png', offered), undefined);
  });
});

describe('F-31 · preset de headers de segurança', () => {
  it("'web' libera recursos do próprio site; 'api' continua o padrão", async () => {
    @Router('/p') class P { @Get('/') page() { return '<h1>oi</h1>'; } }
    const web = await createApp({ logger: false, securityHeaders: 'web' }).mount(P).inject('/p');
    assert.equal(web.headers['content-security-policy'], "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
    assert.equal(web.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(web.headers['x-content-type-options'], 'nosniff');
    const api = await createApp({ logger: false }).mount(P).inject('/p');
    assert.equal(api.headers['content-security-policy'], "default-src 'none'; frame-ancestors 'none'");
  });
});

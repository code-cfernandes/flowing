import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Context, contracts, createApp, Get, Post, Router, type RouteSchemas, Type } from 'sashiko';
import { z } from 'zod';

const Membro = z.object({ nome: z.string().trim().min(2), email: z.email(), ativo: z.boolean().default(true) });
const criar = {
  body: Membro,
  response: { 201: z.object({ id: z.number(), nome: z.string() }) },
} satisfies RouteSchemas;
const buscar = {
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({ detalhes: z.coerce.boolean().optional(), limite: z.coerce.number().max(50).default(10) }),
  headers: z.object({ 'x-tenant': z.string().min(1) }),
  response: { 200: z.object({ id: z.number(), limite: z.number(), tenant: z.string() }) },
} satisfies RouteSchemas;
const unico = new Set(['ana@igreja.org']);
const cadastro = {
  body: z.object({ email: z.email() }).refine(async (b) => !unico.has(b.email), { message: 'e-mail já cadastrado', path: ['email'] }),
  response: { 201: z.object({ ok: z.boolean() }) },
} satisfies RouteSchemas;

@Router('/membros')
class Membros {
  @Post('/', criar) criar(ctx: Context<typeof criar>) {
    const nome: string = ctx.body.nome; // tipado pelo Zod
    const ativo: boolean = ctx.body.ativo;
    return { id: 1, nome: ativo ? nome : '', senha: 'nunca sai', email: ctx.body.email };
  }
  @Get('/:id', buscar) buscar(ctx: Context<typeof buscar>) {
    const id: number = ctx.params.id; // já convertido pelo z.coerce
    return { id, limite: ctx.query.limite, tenant: String(ctx.req.headers['x-tenant']) };
  }
  @Post('/cadastro', cadastro) cadastro() {
    return { ok: true };
  }
  @Get('/quebrado', { response: { 200: z.object({ id: z.number() }) } }) quebrado() {
    return { id: 'não é número' };
  }
}

const app = (opts: Parameters<typeof contracts.standard>[0] = {}) => {
  const a = createApp({ logger: false, shutdown: false, contracts: contracts.standard(opts) });
  a.mount(Membros).openapi();
  return a;
};
const json = { 'content-type': 'application/json' };

describe('F-27 · contracts.standard() (Zod)', () => {
  it('body: valida, aplica o valor transformado (trim, default) e filtra a resposta pelo schema', async () => {
    const r = await app().inject({ method: 'POST', url: '/membros', headers: json, body: { nome: '  Ana  ', email: 'ana@igreja.org' } });
    assert.equal(r.status, 201, 'o 201 vem do único status de sucesso declarado');
    assert.deepEqual(r.json(), { id: 1, nome: 'Ana' }, 'trim aplicado, default aplicado, senha e email fora');
  });

  it('erros no formato de sempre: 400 VALIDATION_ERROR com JSON Pointer', async () => {
    const r = await app().inject({ method: 'POST', url: '/membros', headers: json, body: { nome: 'A', email: 'x' } });
    assert.equal(r.status, 400);
    const body = r.json<{ code: string; details: { path: string }[] }>();
    assert.equal(body.code, 'VALIDATION_ERROR');
    assert.deepEqual(body.details.map((d) => d.path).sort(), ['/email', '/nome']);
  });

  it('params e query com z.coerce; headers validados sem trocar req.headers', async () => {
    const ok = await app().inject({ url: '/membros/7?detalhes=true', headers: { 'x-tenant': 'sede' } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json(), { id: 7, limite: 10, tenant: 'sede' });
    assert.equal((await app().inject({ url: '/membros/7', headers: {} })).status, 400, 'header obrigatório');
    assert.equal((await app().inject({ url: '/membros/-1', headers: { 'x-tenant': 's' } })).status, 400);
    assert.equal((await app().inject({ url: '/membros/7?limite=99', headers: { 'x-tenant': 's' } })).status, 400);
  });

  it('validação assíncrona (refine async) na entrada', async () => {
    const dup = await app().inject({ method: 'POST', url: '/membros/cadastro', headers: json, body: { email: 'ana@igreja.org' } });
    assert.equal(dup.status, 400);
    assert.equal(dup.json<{ details: { path: string; message: string }[] }>().details[0]!.message, 'e-mail já cadastrado');
    const novo = await app().inject({ method: 'POST', url: '/membros/cadastro', headers: json, body: { email: 'bia@igreja.org' } });
    assert.equal(novo.status, 201);
  });

  it('saída que não corresponde ao schema: 500, sem enviar o objeto', async () => {
    const r = await app().inject('/membros/quebrado');
    assert.equal(r.status, 500);
    assert.doesNotMatch(r.body, /não é número/);
  });

  it('OpenAPI: com toJSONSchema, os schemas entram; sem, a rota aparece com {}', async () => {
    const withConv = (await app({ toJSONSchema: (s) => z.toJSONSchema(s as z.ZodType) }).inject('/openapi.json')).json<{
      paths: Record<string, Record<string, { requestBody?: { content: Record<string, { schema: { properties?: object } }> } }>>;
    }>();
    assert.ok(withConv.paths['/membros']!.post!.requestBody!.content['application/json']!.schema.properties);
    const without = (await app().inject('/openapi.json')).json<{
      paths: Record<string, Record<string, { requestBody?: { content: Record<string, { schema: object }> } }>>;
    }>();
    assert.deepEqual(without.paths['/membros']!.post!.requestBody!.content['application/json']!.schema, {});
  });
});

describe('F-27 · sem mistura de motores', () => {
  it('TypeBox num app standard e Zod no nativo falham no registro, com a dica certa', () => {
    @Router('/tb')
    class Tb {
      @Post('/', { body: Type.Object({ a: Type.String() }) }) x() {}
    }
    @Router('/zd')
    class Zd {
      @Post('/', { body: z.object({ a: z.string() }) }) x() {}
    }
    assert.throws(() => createApp({ contracts: contracts.standard() }).mount(Tb), /body schema does not match.*not a Standard Schema/);
    assert.throws(() => createApp().mount(Zd), /body schema does not match.*contracts\.standard\(\)/);
    assert.throws(() => createApp({ contracts: contracts.native() }).mount(Zd), /contracts\.standard\(\)/);
  });

  it('contracts.native() declarado é o mesmo comportamento do padrão', async () => {
    @Router('/n')
    class N {
      @Get('/:id', { params: Type.Object({ id: Type.Integer() }) }) x(ctx: Context) {
        return { id: ctx.params.id, tipo: typeof ctx.params.id };
      }
    }
    for (const a of [
      createApp({ logger: false, shutdown: false }),
      createApp({ logger: false, shutdown: false, contracts: contracts.native() }),
    ]) {
      a.mount(N);
      assert.deepEqual((await a.inject('/n/5')).json(), { id: 5, tipo: 'number' });
    }
  });
});

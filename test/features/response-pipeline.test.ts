import { Type } from '@sinclair/typebox';
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import {
  type Context, createApp, Get, Middlewares, type Middleware, Post, Router, type RouteSchemas,
} from 'sashiko';

const User = Type.Object({ id: Type.String(), name: Type.String() });
const leaky = { id: '1', name: 'Ana', password: 'hash' };

const job = {
  body: Type.Object({ async: Type.Boolean() }),
  response: {
    200: Type.Object({ result: Type.String() }),
    202: Type.Object({ jobId: Type.String() }),
  },
} satisfies RouteSchemas;
const one = { response: { 200: User } } satisfies RouteSchemas;
const jobResponses = { response: job.response } satisfies RouteSchemas;
const created = { response: { 201: User } } satisfies RouteSchemas;
const csvOrJson = { response: { 200: { contentType: ['application/json', 'text/csv'], schema: Type.Array(User) } } } satisfies RouteSchemas;

const maintenance: Middleware = (ctx) => { ctx.status(503).json({ error: 'maintenance', extra: true }); };

@Router('/p')
class P {
  // Mesmo dado, dois estilos: a resposta precisa ser idêntica
  @Get('/return', one) viaReturn() { return leaky; }
  @Get('/json', one) viaJson(ctx: Context<typeof one>) { ctx.json(leaky); }
  @Get('/send', one) viaSend(ctx: Context<typeof one>) { ctx.send(leaky); }

  // Status decidido em runtime
  @Post('/job', job)
  run(ctx: Context<typeof job>) {
    if (ctx.body.async) return ctx.status(202).json({ jobId: 'abc', secret: 1 } as { jobId: string });
    return ctx.status(200).json({ result: 'pronto' });
  }

  // Status padrão (B-05) também no envio imperativo
  @Post('/created', created) create(ctx: Context<typeof created>) { ctx.json(leaky); }

  // Negociação no ctx.send(objeto)
  @Get('/list', csvOrJson) list(ctx: Context<typeof csvOrJson>) { ctx.send([leaky]); }

  // Corpo que não bate com o schema do status → 500, igual ao return
  @Get('/wrong', jobResponses) wrong(ctx: Context<typeof jobResponses>) { ctx.status(202).json({ result: 'x' } as unknown as { jobId: string }); }

  // ctx.json(string) é JSON; ctx.text é texto
  @Get('/json-string') js(ctx: Context) { ctx.json('olá'); }
  @Get('/text') tx(ctx: Context) { ctx.text('olá'); }

  // Middleware responde antes do handler: sem schema da rota
  @Middlewares(maintenance) @Get('/maint', one) maint() { return leaky; }
}

const app = createApp({ logger: false, serializers: { 'text/csv': (rows) => (rows as { id: string; name: string }[]).map((r) => `${r.id},${r.name}`).join('\n') } }).mount(P);

describe('F-32 · pipeline único de resposta', () => {
  it('return, ctx.json e ctx.send produzem a mesma resposta e não vazam campos', async () => {
    const bodies = await Promise.all(['/p/return', '/p/json', '/p/send'].map(async (u) => {
      const r = await app.inject(u);
      return { status: r.status, type: r.headers['content-type'], body: r.body };
    }));
    assert.deepEqual(bodies[0], { status: 200, type: 'application/json; charset=utf-8', body: '{"id":"1","name":"Ana"}' });
    assert.deepEqual(bodies[1], bodies[0]);
    assert.deepEqual(bodies[2], bodies[0]);
  });

  it('status decidido em runtime usa o schema daquele status', async () => {
    const sync = await app.inject({ method: 'POST', url: '/p/job', body: { async: false } });
    assert.deepEqual([sync.status, sync.json()], [200, { result: 'pronto' }]);
    const asyncRes = await app.inject({ method: 'POST', url: '/p/job', body: { async: true } });
    assert.deepEqual([asyncRes.status, asyncRes.json()], [202, { jobId: 'abc' }], 'campo extra removido pelo schema do 202');
  });

  it('status padrão do único 2xx vale para ctx.json sem ctx.status', async () => {
    const res = await app.inject({ method: 'POST', url: '/p/created', body: {} });
    assert.equal(res.status, 201);
    assert.deepEqual(res.json(), { id: '1', name: 'Ana' });
  });

  it('ctx.send(objeto) negocia pelo Accept e filtra campos', async () => {
    const res = await app.inject({ url: '/p/list', headers: { accept: 'text/csv' } });
    assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal(res.body, '1,Ana');
  });

  it('corpo que não bate com o schema do status → 500, como no return', async () => {
    const errorLog = mock.method(console, 'error', () => {});
    try {
      assert.equal((await createApp().mount(P).inject('/p/wrong')).status, 500);
    } finally { errorLog.mock.restore(); }
  });

  it('ctx.json(string) codifica como JSON; ctx.text envia texto', async () => {
    const j = await app.inject('/p/json-string');
    assert.deepEqual([j.headers['content-type'], j.body], ['application/json; charset=utf-8', '"olá"']);
    const t = await app.inject('/p/text');
    assert.deepEqual([t.headers['content-type'], t.body], ['text/plain; charset=utf-8', 'olá']);
  });

  it('middleware que responde antes do handler não passa pelo schema da rota', async () => {
    const res = await app.inject('/p/maint');
    assert.equal(res.status, 503);
    assert.deepEqual(res.json(), { error: 'maintenance', extra: true });
  });

  it('erros e 404/405 continuam sem o schema da rota', async () => {
    assert.deepEqual((await app.inject('/nada')).json(), { error: 'Not Found' });
    assert.equal((await app.inject({ method: 'DELETE', url: '/p/return' })).status, 405);
    const bad = await app.inject({ method: 'POST', url: '/p/job', body: { async: 'x' } });
    assert.equal(bad.status, 400);
    assert.equal((bad.json() as { error: string }).error, 'Invalid body');
  });
});

// ---------- Checagens de tipo ----------
function _types(ctx: Context<typeof job>, free: Context) {
  ctx.status(202).json({ jobId: 'x' });
  ctx.status(200).json({ result: 'x' });
  // @ts-expect-error: o 202 espera { jobId }
  ctx.status(202).json({ result: 'x' });
  // @ts-expect-error: 201 não está declarado no schema
  ctx.status(201);
  // Sem schema: qualquer status e corpo
  free.status(418).json({ qualquer: true });
  free.status(204).send('');
  // O encadeamento mantém os outros helpers
  ctx.status(202).header('X-Job', '1').text('ok');
}
void _types;

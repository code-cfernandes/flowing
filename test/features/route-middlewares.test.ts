import { Type } from '@sinclair/typebox';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type Context, Controller, createApp, Get, type Guard, type Middleware, Post, Schema, unauthorized, Use, UseGuards,
} from 'picodecor';

declare module 'picodecor' {
  interface ContextState {
    trail?: string[];
    user?: { id: string; role: 'admin' | 'user' };
  }
}

const mark = (name: string): Middleware => async (ctx, next) => {
  (ctx.state.trail ??= []).push(name);
  await next();
};

// Autenticação fake: "Authorization: Bearer <role>"
const authenticate: Middleware = async (ctx, next) => {
  const role = ctx.get('authorization')?.replace(/^Bearer /, '');
  if (role === 'admin' || role === 'user') ctx.state.user = { id: '1', role };
  await next();
};
const isLogged: Guard = (ctx) => {
  if (!ctx.state.user) throw unauthorized('login required');
  return true;
};
const isAdmin: Guard = (ctx) => ctx.state.user?.role === 'admin';

@Use(mark('class-1'), mark('class-2'))
@Controller('/m')
class M {
  @Use(mark('method-1'))
  @Use(mark('method-2'))
  @Get('/order')
  order(ctx: Context) { return { trail: [...(ctx.state.trail ?? []), 'handler'] }; }

  @Get('/plain')
  plain(ctx: Context) { return { trail: ctx.state.trail }; }
}

@Use(authenticate)
@UseGuards(isLogged)
@Controller('/admin')
class Admin {
  @Get('/me') me(ctx: Context) { return ctx.state.user; }

  @UseGuards(isAdmin)
  @Post('/danger')
  @Schema({ body: Type.Object({ confirm: Type.Literal(true) }) })
  danger() { return { done: true }; }
}

@Controller('/admin2')
class ChildAdmin extends Admin {
  @Get('/child') child(ctx: Context) { return { role: ctx.state.user?.role }; }
}

const shortCircuit: Middleware = (ctx) => { ctx.status(503).json({ error: 'maintenance' }); };
@Controller('/sc')
class SC { @Use(shortCircuit) @Get('/') never() { throw new Error('não deveria executar'); } }

const app = createApp()
  .use(mark('global'))
  .controllers([M, Admin, ChildAdmin, SC]);

const bearer = (role: string) => ({ authorization: `Bearer ${role}` });

describe('F-01 · @Use', () => {
  it('ordem: global → classe (de cima para baixo) → método (de cima para baixo) → handler', async () => {
    const res = await app.inject('/m/order');
    assert.deepEqual(res.json(), { trail: ['global', 'class-1', 'class-2', 'method-1', 'method-2', 'handler'] });
  });

  it('middlewares de classe valem para todas as rotas; os de método, só para a sua', async () => {
    assert.deepEqual((await app.inject('/m/plain')).json(), { trail: ['global', 'class-1', 'class-2'] });
  });

  it('um middleware pode encerrar a resposta sem chamar o handler', async () => {
    const res = await app.inject('/sc');
    assert.equal(res.status, 503);
    assert.deepEqual(res.json(), { error: 'maintenance' });
  });

  it('middlewares de rota não rodam para 404', async () => {
    const res = await app.inject('/m/nada');
    assert.equal(res.status, 404);
  });
});

describe('F-01 · @UseGuards', () => {
  it('guard que lança unauthorized() responde 401', async () => {
    const res = await app.inject('/admin/me');
    assert.equal(res.status, 401);
    assert.deepEqual(res.json(), { error: 'login required' });
  });

  it('guards passam e o ctx.state chega tipado ao handler', async () => {
    const res = await app.inject({ url: '/admin/me', headers: bearer('user') });
    assert.deepEqual(res.json(), { id: '1', role: 'user' });
  });

  it('guard que retorna false responde 403', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/danger', headers: bearer('user'), body: { confirm: true } });
    assert.equal(res.status, 403);
    assert.deepEqual(res.json(), { error: 'Forbidden' });
  });

  it('guards rodam antes da validação: sem permissão não há 400 revelando o schema', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/danger', headers: bearer('user'), body: { wrong: 1 } });
    assert.equal(res.status, 403);
  });

  it('com permissão, a validação acontece normalmente', async () => {
    const bad = await app.inject({ method: 'POST', url: '/admin/danger', headers: bearer('admin'), body: { wrong: 1 } });
    assert.equal(bad.status, 400);
    const ok = await app.inject({ method: 'POST', url: '/admin/danger', headers: bearer('admin'), body: { confirm: true } });
    assert.deepEqual(ok.json(), { done: true });
  });

  it('subclasse herda @Use e @UseGuards de classe do pai', async () => {
    assert.equal((await app.inject('/admin2/child')).status, 401);
    assert.deepEqual((await app.inject({ url: '/admin2/child', headers: bearer('admin') })).json(), { role: 'admin' });
  });

  it('subclasse herda as rotas do pai com seus guards de método', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin2/danger', headers: bearer('user'), body: { confirm: true } });
    assert.equal(res.status, 403);
  });

  it('a classe base não recebe as rotas da subclasse', async () => {
    assert.equal((await app.inject({ url: '/admin/child', headers: bearer('admin') })).status, 404);
  });
});

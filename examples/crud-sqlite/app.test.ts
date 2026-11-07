import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from './app.ts';
import { TaskRepository } from './db.ts';

describe('exemplo crud-sqlite', () => {
  const app = buildApp(new TaskRepository());
  const json = { 'content-type': 'application/json' };

  it('cria, lista, filtra, atualiza e remove', async () => {
    const created = await app.inject({ method: 'POST', url: '/tasks', headers: json, body: { title: 'comprar café' } });
    assert.equal(created.status, 201);
    assert.deepEqual(created.json(), { id: 1, title: 'comprar café', done: false });
    await app.inject({ method: 'POST', url: '/tasks', headers: json, body: { title: 'revisar PR' } });

    const patched = await app.inject({ method: 'PATCH', url: '/tasks/1', headers: json, body: { done: true } });
    assert.deepEqual(patched.json(), { id: 1, title: 'comprar café', done: true });

    assert.equal((await app.inject('/tasks')).json<unknown[]>().length, 2);
    assert.deepEqual(
      (await app.inject('/tasks?done=false')).json<{ title: string }[]>().map((t) => t.title),
      ['revisar PR'],
      'a query é convertida para boolean pelo schema',
    );

    assert.equal((await app.inject({ method: 'DELETE', url: '/tasks/1' })).status, 204);
    assert.equal((await app.inject('/tasks/1')).status, 404);
  });

  it('valida a entrada antes do handler', async () => {
    const empty = await app.inject({ method: 'POST', url: '/tasks', headers: json, body: { title: '' } });
    assert.equal(empty.status, 400);
    const extra = await app.inject({ method: 'POST', url: '/tasks', headers: json, body: { title: 'x', admin: true } });
    assert.equal(extra.status, 400, 'additionalProperties: false');
    assert.equal((await app.inject('/tasks/abc')).status, 400, 'o id precisa ser inteiro');
    const noFields = await app.inject({ method: 'PATCH', url: '/tasks/2', headers: json, body: {} });
    assert.equal(noFields.status, 400, 'minProperties: 1');
  });

  it('erros saem em Problem Details', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/tasks/999' });
    assert.equal(res.status, 404);
    assert.match(String(res.headers['content-type']), /application\/problem\+json/);
    assert.equal(res.json<{ detail: string }>().detail, 'task not found');
  });
});

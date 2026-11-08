import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from './app.ts';

describe('exemplo contracts-zod', () => {
  const app = buildApp();
  const json = { 'content-type': 'application/json' };

  it('cria com o valor do Zod (trim, default) e a saída sem os campos internos', async () => {
    const r = await app.inject({ method: 'POST', url: '/membros', headers: json, body: { nome: '  Ana  ', email: 'ana@igreja.org' } });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json(), { id: 1, nome: 'Ana', ministerios: [] });
  });

  it('busca com o id convertido pelo z.coerce; 400 e 404 em Problem Details', async () => {
    assert.deepEqual((await app.inject('/membros/1')).json(), { id: 1, nome: 'Ana', ministerios: [] });
    assert.equal((await app.inject('/membros/abc')).status, 400);
    assert.equal((await app.inject('/membros/99')).status, 404);
    const invalido = await app.inject({ method: 'POST', url: '/membros', headers: json, body: { nome: 'A', email: 'x' } });
    assert.equal(invalido.json<{ code: string }>().code, 'VALIDATION_ERROR');
  });

  it('o OpenAPI traz os schemas convertidos pelo Zod', async () => {
    const doc = (await app.inject('/openapi.json')).json<{
      paths: Record<string, { post?: { requestBody: { content: Record<string, { schema: { properties: object } }> } } }>;
    }>();
    assert.ok('email' in doc.paths['/membros']!.post!.requestBody.content['application/json']!.schema.properties);
  });
});

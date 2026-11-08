import { Type } from '@sinclair/typebox';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Context, createApp, Get, Post, Router, type RouteSchemas, Schema } from 'flowingts';

const Item = Type.Object({ id: Type.String() });
const byId = { params: Type.Object({ id: Type.String({ pattern: '^[0-9]+$' }) }), response: { 200: Item } } satisfies RouteSchemas;
const create = {
  body: Type.Object({ name: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  response: { 201: Item },
} satisfies RouteSchemas;

@Router('/v')
class VerbSchemas {
  // Forma enxuta: schemas no próprio verbo
  @Get('/:id', byId)
  getById(ctx: Context<typeof byId>) {
    return { id: ctx.params.id, secret: 'x' };
  }

  @Post('/', create)
  create(ctx: Context<typeof create>) {
    return { id: ctx.body.name };
  }

  // Forma verbosa continua funcionando
  @Get('/verbose/:id')
  @Schema(byId)
  verbose(ctx: Context<typeof byId>) {
    return { id: ctx.params.id };
  }

  // As duas juntas, com partes diferentes, se combinam
  @Get('/mixed/:id', { params: byId.params })
  @Schema({ response: byId.response })
  mixed(ctx: Context<typeof byId>) {
    return { id: ctx.params.id, secret: 'x' };
  }
}

describe('@Get(path, schemas) e @Schema convivendo', () => {
  const app = createApp({ logger: false }).mount(VerbSchemas);

  it('schemas no verbo validam params e filtram a resposta', async () => {
    assert.deepEqual((await app.inject('/v/42')).json(), { id: '42' });
    assert.equal((await app.inject('/v/abc')).status, 400);
  });

  it('schemas no verbo validam o body e definem o status padrão', async () => {
    const ok = await app.inject({ method: 'POST', url: '/v', body: { name: 'a' } });
    assert.equal(ok.status, 201);
    assert.equal((await app.inject({ method: 'POST', url: '/v', body: { name: 'a', x: 1 } })).status, 400);
  });

  it('@Schema separado continua funcionando', async () => {
    assert.deepEqual((await app.inject('/v/verbose/7')).json(), { id: '7' });
    assert.equal((await app.inject('/v/verbose/x')).status, 400);
  });

  it('partes diferentes no verbo e no @Schema se combinam', async () => {
    assert.deepEqual((await app.inject('/v/mixed/9')).json(), { id: '9' }, 'response do @Schema filtrou');
    assert.equal((await app.inject('/v/mixed/x')).status, 400, 'params do @Get validou');
  });

  it('a mesma parte nos dois lugares gera erro na declaração', () => {
    assert.throws(() => {
      @Router('/dup')
      class Dup {
        @Post('/', { body: Type.Object({}) })
        @Schema({ body: Type.Object({}) })
        a() {}
      }
      void Dup;
    }, /schema "body" is declared twice for a\. Declare each part either in the HTTP decorator or in @Schema/);
  });

  it('dois @Schema com a mesma parte também geram erro', () => {
    assert.throws(() => {
      @Router('/dup2')
      class Dup2 {
        @Get('/')
        @Schema({ response: { 200: Type.Object({}) } })
        @Schema({ response: { 200: Type.Object({}) } })
        a() {}
      }
      void Dup2;
    }, /schema "response" is declared twice/);
  });
});

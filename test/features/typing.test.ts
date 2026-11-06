import { type Static, Type } from '@sinclair/typebox';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type Context, Router, createApp, Get, type InferBody, type InferParams, type InferQuery, type InferResponse,
  type InferSchema, Post, type RouteSchemas, Schema,
} from 'sashiko';

// ---------- Asserções de tipo: falham no `pnpm typecheck` ----------
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const assertType = <T extends true>(_?: T) => {};

const User = Type.Object({ id: Type.String(), name: Type.String(), age: Type.Optional(Type.Integer()) });
const create = {
  params: Type.Object({ org: Type.String() }),
  query: Type.Object({ dryRun: Type.Boolean({ default: false }) }),
  body: Type.Object({ name: Type.String(), tags: Type.Array(Type.String()) }),
  response: { 201: User, 409: Type.Object({ error: Type.String() }) },
} satisfies RouteSchemas;

assertType<Equal<InferParams<typeof create>, { org: string }>>();
assertType<Equal<InferQuery<typeof create>, { dryRun: boolean }>>();
assertType<Equal<InferBody<typeof create>, { name: string; tags: string[] }>>();
assertType<Equal<InferResponse<typeof create, 201>, Static<typeof User>>>();
assertType<Equal<InferResponse<typeof create>, Static<typeof User> | { error: string }>>();

// Sem schema: tipos padrão
assertType<Equal<InferParams<{}>, Record<string, string>>>();
assertType<Equal<InferQuery<{}>, Record<string, string | string[]>>>();
assertType<Equal<InferBody<{}>, unknown>>();

// Standard Schema (forma estrutural usada por Zod/Valibot/ArkType)
type FakeStandard = { '~standard': { version: 1; vendor: 'x'; types?: { input: string; output: number } } };
assertType<Equal<InferSchema<FakeStandard>, number>>();

// Context<S> tipa os campos
// Só checagem de tipo: a função nunca é executada.
function _typedContext(ctx: Context<typeof create>) {
  assertType<Equal<typeof ctx.body.tags, string[]>>();
  assertType<Equal<typeof ctx.params.org, string>>();
  // @ts-expect-error: campo inexistente no schema
  void ctx.body.nope;
}
void _typedContext;

// ---------- Runtime: o Context tipado recebe os valores validados ----------
@Router('/orgs/:org/users')
class Users {
  @Post('/')
  @Schema(create)
  create(ctx: Context<typeof create>): InferResponse<typeof create, 201> {
    const { name } = ctx.body;           // string, sem cast
    const dry: boolean = ctx.query.dryRun; // boolean após coerção + default
    return { id: dry ? 'dry' : `${ctx.params.org}-1`, name };
  }

  @Get('/plain')
  plain(ctx: Context) { return { org: ctx.params.org }; } // sem schema: Record<string, string>
}

describe('F-02 · Context<S> tipado pelo schema', () => {
  const app = createApp({ logger: false }).mount(Users);

  it('handler tipado recebe body, params e query já validados e com defaults', async () => {
    const res = await app.inject({ method: 'POST', url: '/orgs/acme/users', body: { name: 'Ana', tags: [] } });
    assert.equal(res.status, 201);
    assert.deepEqual(res.json(), { id: 'acme-1', name: 'Ana' });
  });

  it('query coagida para boolean', async () => {
    const res = await app.inject({ method: 'POST', url: '/orgs/acme/users?dryRun=true', body: { name: 'Ana', tags: [] } });
    assert.deepEqual(res.json(), { id: 'dry', name: 'Ana' });
  });

  it('Context sem genérico continua funcionando', async () => {
    assert.deepEqual((await app.inject('/orgs/acme/users/plain')).json(), { org: 'acme' });
  });
});

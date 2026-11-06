import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Context, createApp, Get, type ParamsOf, type PathParams, Post, Router, Schema, Type } from 'sashiko';
import { pathParams } from '../../src/utils/path.ts';

// ---------- Asserções de tipo: falham no `pnpm typecheck` ----------
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <T extends true>(_?: T) => {};

assertType<Equal<PathParams<'/:orgId/users/:id'>, 'orgId' | 'id'>>();
assertType<Equal<PathParams<'/:id(^\\d+)/x'>, 'id'>>();
assertType<Equal<PathParams<'/geo/:lat-:lng'>, 'lat' | 'lng'>>();
assertType<Equal<PathParams<'/files/*'>, '*'>>();
assertType<Equal<PathParams<'/a::b/:c'>, 'c'>>();
assertType<Equal<PathParams<'/static'>, never>>();
assertType<Equal<PathParams<string>, string>>();
assertType<Equal<ParamsOf<'/:a/:b'>, { a: string; b: string }>>();

const byId = { params: Type.Object({ id: Type.String() }) };

@Router('/t')
class Typed {
  @Get('/:id', byId) ok(ctx: Context<typeof byId>) {
    return ctx.params.id;
  }

  // @ts-expect-error: o path diz userId, o schema diz id
  @Get('/:userId', byId) wrongName() {}

  // @ts-expect-error: o schema não declara "org"
  @Get('/:org/:id', byId) missing() {}

  // Sem schema de params, nada a conferir; com path dinâmico, a checagem é desligada.
  @Get('/:anything') noSchema(ctx: Context<'/:anything'>) {
    assertType<Equal<typeof ctx.params, { anything: string }>>();
    // @ts-expect-error: "idd" não existe no path
    void ctx.params.idd;
    return ctx.params.anything;
  }
  @Get('/x/:id' as string, byId) dynamic() {}
}
void Typed;

// ---------- Runtime ----------
describe('F-29 · pathParams', () => {
  it('extrai nomes, ignora regex e :: e reconhece o curinga', () => {
    assert.deepEqual(pathParams('/:org/users/:id(^\\d+)'), ['org', 'id']);
    assert.deepEqual(pathParams('/geo/:lat-:lng'), ['lat', 'lng']);
    assert.deepEqual(pathParams('/a::b/:c'), ['c']);
    assert.deepEqual(pathParams('/x/:id((a|b))/y'), ['id']);
    assert.deepEqual(pathParams('/files/*'), ['*']);
    assert.deepEqual(pathParams('/'), []);
  });

  it('recusa parâmetro sem nome, repetido, regex aberta e * no meio', () => {
    assert.throws(() => pathParams('/:'), /without a name/);
    assert.throws(() => pathParams('/:/x'), /without a name/);
    assert.throws(() => pathParams('/:id/:id'), /repeated/);
    assert.throws(() => pathParams('/:id(^\\d+'), /unterminated/);
    assert.throws(() => pathParams('/*/x'), /only allowed at the end/);
  });
});

describe('F-29 · checagem no registro', () => {
  const ById = Type.Object({ id: Type.String() });

  it('path e schema que batem registram e funcionam, inclusive com prefixo parametrizado', async () => {
    @Router('/orgs/:org')
    class Ok {
      @Get('/users/:id', { params: Type.Object({ org: Type.String(), id: Type.String() }) })
      get(ctx: Context) {
        return ctx.params;
      }
    }
    const res = await createApp({ logger: false }).mount(Ok).inject('/orgs/acme/users/7');
    assert.deepEqual(res.json(), { org: 'acme', id: '7' });
  });

  it('nome divergente via @Schema falha no mount, com a rota na mensagem', () => {
    @Router('/u')
    class Wrong {
      @Get('/:userId') @Schema({ params: ById }) get() {}
    }
    assert.throws(
      () => createApp().mount(Wrong),
      /Wrong\.get \(GET \/u\/:userId\): params schema does not match the path; missing in params schema: "userId"; not in path: "id"/,
    );
  });

  it('parâmetro do prefixo do mount precisa estar no schema', () => {
    @Router('/u')
    class R {
      @Get('/:id', { params: ById }) get() {}
    }
    assert.throws(() => createApp().mount(R, { prefix: '/orgs/:org' }), /missing in params schema: "org"/);
  });

  it('rota manual também é conferida', () => {
    @Router('/u')
    class R {
      @Schema({ params: ById }) get() {}
    }
    assert.throws(
      () =>
        createApp()
          .mount(R, { auto: false })
          .get('/legacy/:uid', (r) => r.get),
      /"uid"/,
    );
  });

  it('path malformado falha no mount', () => {
    @Router('/u')
    class R {
      @Post('/:a/:a') dup() {}
    }
    assert.throws(() => createApp().mount(R), /R\.dup \(POST \/u\/:a\/:a\): invalid path .*repeated/);
  });
});

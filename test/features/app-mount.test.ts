import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type Context,
  createApp,
  Delete,
  Get,
  type Guard,
  type Middleware,
  Post,
  Router,
  unauthorized,
  Middlewares,
  Guards,
} from 'flowingts';

const mark =
  (name: string): Middleware =>
  async (ctx, next) => {
    ((ctx.state.trail as string[] | undefined) ?? (ctx.state.trail = [])) && (ctx.state.trail as string[]).push(name);
    await next();
  };
const guardMark =
  (name: string): Guard =>
  (ctx) => {
    (ctx.state.trail as string[]).push(name);
    return true;
  };

@Middlewares(mark('class'))
@Guards(guardMark('class-guard'))
@Router('/items')
class ItemRoutes {
  @Get('/') list(ctx: Context) {
    return { trail: ctx.state.trail };
  }
  @Get('/:id') getById(ctx: Context) {
    return { id: ctx.params.id };
  }
  @Delete('/:id') remove() {
    return { removed: true };
  }
  // Método comum (sem decorator de rota): não pode ser usado em only/except
  helper() {
    return 1;
  }
}

class Repo {
  find() {
    return 'from-repo';
  }
}
@Router('/repo')
class WithDeps {
  constructor(private readonly repo: Repo) {}
  @Get('/') get() {
    return { value: this.repo.find() };
  }
  @Post('/') create() {
    return { created: true };
  }
}

describe('F-28 · @Router e app.mount()', () => {
  it('registra a classe com o prefixo do @Router', async () => {
    const app = createApp({ logger: false }).mount(ItemRoutes);
    assert.deepEqual((await app.inject('/items/7')).json(), { id: '7' });
  });

  it('prefix substitui o prefixo do @Router; a mesma classe pode ser montada duas vezes', async () => {
    const app = createApp({ logger: false })
      .mount(ItemRoutes, { prefix: '/v1/items' })
      .mount(ItemRoutes, { prefix: '/v2/items', only: (r) => [r.getById] });
    assert.deepEqual((await app.inject('/v1/items/1')).json(), { id: '1' });
    assert.deepEqual((await app.inject('/v2/items/2')).json(), { id: '2' });
    assert.equal((await app.inject('/v2/items')).status, 404, 'list não foi exposto em v2 (nenhuma rota nesse path)');
    assert.equal((await app.inject('/items/1')).status, 404, 'prefixo original não foi registrado');
  });

  it('only expõe apenas os métodos listados', async () => {
    const app = createApp({ logger: false }).mount(ItemRoutes, { only: (r) => [r.list, r.getById] });
    assert.equal((await app.inject('/items/1')).status, 200);
    assert.equal((await app.inject({ method: 'DELETE', url: '/items/1' })).status, 405);
  });

  it('except remove os métodos listados', async () => {
    const app = createApp({ logger: false }).mount(ItemRoutes, { except: (r) => [r.remove] });
    assert.equal((await app.inject({ method: 'DELETE', url: '/items/1' })).status, 405);
    assert.equal((await app.inject('/items')).status, 200);
  });

  it('middlewares e guards do registro rodam antes dos da classe', async () => {
    const app = createApp({ logger: false })
      .use(mark('global'))
      .mount(ItemRoutes, { middlewares: [mark('route-1'), mark('route-2')], guards: [guardMark('route-guard')] });
    assert.deepEqual((await app.inject('/items')).json(), {
      trail: ['global', 'route-1', 'route-2', 'class', 'route-guard', 'class-guard'],
    });
  });

  it('guards do registro protegem todas as rotas da classe (ex.: autenticação)', async () => {
    const requireToken: Guard = (ctx) => {
      if (!ctx.get('authorization')) throw unauthorized();
      return true;
    };
    const app = createApp({ logger: false })
      .mount(ItemRoutes, { prefix: '/public', only: (r) => [r.list] })
      .mount(ItemRoutes, { prefix: '/private', guards: [requireToken] });
    assert.equal((await app.inject('/public')).status, 200);
    assert.equal((await app.inject('/private/1')).status, 401);
    assert.equal((await app.inject({ url: '/private/1', headers: { authorization: 'x' } })).status, 200);
  });

  it('aceita instâncias com dependências e opções', async () => {
    const app = createApp({ logger: false }).mount(new WithDeps(new Repo()), { only: (r) => [r.get] });
    assert.deepEqual((await app.inject('/repo')).json(), { value: 'from-repo' });
    assert.equal((await app.inject({ method: 'POST', url: '/repo' })).status, 405);
  });

  it('only e except juntos geram erro', () => {
    assert.throws(
      () => createApp().mount(ItemRoutes, { only: (r) => [r.list], except: (r) => [r.remove] }),
      /use either "only" or "except"/,
    );
  });

  it('nome que não é método de rota gera erro com a lista disponível', () => {
    assert.throws(
      () => createApp().mount(ItemRoutes, { only: (r) => [r.helper] }),
      /app\.mount\(ItemRoutes\) only: "helper" has no Flowing decorator .* Available: list, getById, remove\./,
    );
  });

  it('mesma classe com o mesmo prefixo duas vezes gera erro claro', () => {
    assert.throws(() => createApp().mount(ItemRoutes).mount(ItemRoutes), /GET \/items\/ is already registered\. Use a different "prefix"/);
  });

  it('classe sem @Router é recusada', () => {
    class Plain {
      @Get('/') a() {}
    }
    assert.throws(() => createApp().mount(Plain), /Plain is not decorated with @Router/);
  });
});

// ---------- Checagens de tipo (falham no `pnpm typecheck`) ----------
function _types() {
  const app = createApp();
  app.mount(ItemRoutes, { only: (r) => [r.list, r.getById] });
  // @ts-expect-error: nome inexistente na classe
  app.mount(ItemRoutes, { only: (r) => [r.lista] });
  // @ts-expect-error: classe com dependências no construtor precisa ser passada como instância
  app.mount(WithDeps);
  app.mount(new WithDeps(new Repo()), { except: (r) => [r.create] });
  // @ts-expect-error: nome inexistente na instância
  app.mount(new WithDeps(new Repo()), { except: (r) => [r.nope] });
}
void _types;

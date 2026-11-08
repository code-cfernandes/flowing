import { Type } from '@sinclair/typebox';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type Context,
  createApp,
  Get,
  type Guard,
  Guards,
  type Middleware,
  Middlewares,
  MountedGroup,
  Router,
  type RouteSchemas,
  Schema,
  unauthorized,
} from 'flowingts';
import { startServer } from '../helpers/server.ts';

const trail =
  (name: string): Middleware =>
  async (ctx, next) => {
    (ctx.state['trail'] as string[] | undefined) ??= [] as string[];
    (ctx.state['trail'] as string[]).push(name);
    await next();
  };
const gTrail =
  (name: string): Guard =>
  (ctx) => {
    (ctx.state['trail'] as string[]).push(name);
    return true;
  };

const byId = {
  params: Type.Object({ id: Type.String({ pattern: '^[0-9]+$' }) }),
  response: { 200: Type.Object({ id: Type.String() }) },
} satisfies RouteSchemas;

class Repo {
  label = 'repo';
}

@Middlewares(trail('class-mw'))
@Guards(gTrail('class-guard'))
@Router('/users')
class UserRoutes {
  constructor(private readonly repo: Repo = new Repo()) {}

  @Middlewares(trail('method-mw'))
  @Guards(gTrail('method-guard'))
  @Get('/:id', byId)
  getUser(ctx: Context<typeof byId>) {
    return { id: ctx.params.id, secret: 'x', trail: ctx.state['trail'] };
  }

  // Sem verbo: só pode ser exposto por mapeamento manual
  @Schema({ response: { 200: Type.Object({ csv: Type.String(), from: Type.String() }) } })
  exportCsv() {
    return { csv: 'id\n1', from: this.repo.label };
  }

  @Get('/trail/all')
  showTrail(ctx: Context) {
    return { trail: ctx.state['trail'] };
  }

  // Sem decorator: nunca pode ser exposto
  helper() {
    return 'interno';
  }
}

describe('F-30 · mapeamento manual no mount', () => {
  it('mapeia outro path para um método com verbo, herdando schemas (validação e filtro)', async () => {
    const app = createApp({ logger: false })
      .mount(new UserRoutes())
      .get('/legacy/:id', (r) => r.getUser);
    const ok = await app.inject('/users/legacy/7');
    assert.equal(ok.status, 200);
    assert.deepEqual(Object.keys(ok.json() as object).sort(), ['id'], 'response schema do método filtrou');
    assert.equal((await app.inject('/users/legacy/abc')).status, 400, 'params schema do método validou');
    assert.equal((await app.inject('/users/7')).status, 200, 'rota automática continua registrada');
  });

  it('expõe método sem verbo (só @Schema) num path novo, com a instância e suas dependências', async () => {
    const app = createApp({ logger: false })
      .mount(new UserRoutes(new Repo()))
      .get('/export.csv', (r) => r.exportCsv);
    assert.deepEqual((await app.inject('/users/export.csv')).json(), { csv: 'id\n1', from: 'repo' });
  });

  it('funciona com a classe (instância criada pelo framework) e com verbos diferentes do declarado', async () => {
    const app = createApp({ logger: false })
      .mount(UserRoutes)
      .post('/search/:id', (r) => r.getUser);
    assert.equal((await app.inject({ method: 'POST', url: '/users/search/3' })).status, 200);
  });

  it('paths manuais são relativos ao prefixo do mount', async () => {
    const app = createApp({ logger: false })
      .mount(UserRoutes, { prefix: '/v2' })
      .get('/csv', (r) => r.exportCsv);
    assert.equal((await app.inject('/v2/csv')).status, 200);
    assert.equal((await app.inject('/users/csv')).status, 404);
  });

  it('ordem: global → mount → classe → método → rota manual, para middlewares e para guards', async () => {
    const app = createApp({ logger: false })
      .use(trail('global'))
      .mount(UserRoutes, { middlewares: [trail('mount-mw')], guards: [gTrail('mount-guard')], auto: false })
      .get('/x/:id', (r) => r.getUser, { middlewares: [trail('route-mw')], guards: [gTrail('route-guard')] });
    const body = (await app.inject('/users/x/1')).json() as Record<string, unknown>;
    assert.equal(body['trail'], undefined, 'response schema remove o campo trail');
    const raw = await createApp({ logger: false })
      .use(trail('global'))
      .mount(UserRoutes, { middlewares: [trail('mount-mw')], guards: [gTrail('mount-guard')], auto: false })
      .get('/t', (r) => r.showTrail, { middlewares: [trail('route-mw')], guards: [gTrail('route-guard')] })
      .inject('/users/t');
    assert.deepEqual(raw.json(), {
      trail: ['global', 'mount-mw', 'class-mw', 'route-mw', 'mount-guard', 'class-guard', 'route-guard'],
    });
  });

  it('guards da rota manual protegem só aquela rota', async () => {
    const deny: Guard = () => {
      throw unauthorized('nope');
    };
    const app = createApp({ logger: false })
      .mount(UserRoutes)
      .get('/private/:id', (r) => r.getUser, { guards: [deny] });
    assert.equal((await app.inject('/users/private/1')).status, 401);
    assert.equal((await app.inject('/users/1')).status, 200);
  });

  it('auto: false registra só as rotas manuais', async () => {
    const app = createApp({ logger: false })
      .mount(UserRoutes, { auto: false })
      .get('/only/:id', (r) => r.getUser);
    assert.equal((await app.inject('/users/1')).status, 404);
    assert.equal((await app.inject('/users/only/1')).status, 200);
  });

  it('método sem decorator é recusado', () => {
    assert.throws(
      () =>
        createApp()
          .mount(UserRoutes)
          .get('/h', (r) => r.helper),
      /app\.mount\(UserRoutes\)\.get\('\/h'\): "helper" has no FlowingTS decorator .*cannot be exposed/,
    );
  });

  it('função que não é método da instância é recusada', () => {
    const other = () => 1;
    assert.throws(
      () =>
        createApp()
          .mount(UserRoutes)
          .get('/o', () => other),
      /"other" is not a method of UserRoutes/,
    );
  });

  it('o mesmo path manual duas vezes gera erro de rota duplicada', () => {
    assert.throws(
      () =>
        createApp()
          .mount(UserRoutes)
          .get('/d', (r) => r.exportCsv)
          .get('/d', (r) => r.exportCsv),
      /GET \/users\/d is already registered/,
    );
  });

  it('o grupo encadeia mount e expõe os métodos do app', async () => {
    @Router('/health')
    class Health {
      @Get('/') ok() {
        return { ok: true };
      }
    }
    const group = createApp({ logger: false })
      .mount(UserRoutes)
      .get('/csv', (r) => r.exportCsv)
      .mount(Health);
    assert.ok(group instanceof MountedGroup);
    assert.deepEqual((await group.inject('/health')).json(), { ok: true });
    const srv = await startServer(group);
    try {
      assert.equal((await fetch(srv.url + '/users/csv')).status, 200);
    } finally {
      await srv.close();
    }
  });

  it('os métodos do app continuam disponíveis no grupo (use, onError, callback, log, todos os verbos)', async () => {
    @Router('/v')
    class V {
      @Schema({}) handler(ctx: Context) {
        return { m: ctx.method, ran: ctx.state['ran'] ?? false };
      }
      @Get('/boom') boom() {
        throw new Error('x');
      }
    }
    let handled = false;
    const group = createApp({ logger: false })
      .mount(V)
      .post('/', (r) => r.handler)
      .put('/', (r) => r.handler)
      .patch('/', (r) => r.handler)
      .delete('/', (r) => r.handler);
    group.use(async (ctx, next) => {
      ctx.state['ran'] = true;
      await next();
    });
    group.onError(() => {
      handled = true;
    });
    assert.equal(typeof group.callback(), 'function');
    assert.equal(typeof group.log.info, 'function');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.deepEqual((await group.inject({ method, url: '/v' })).json(), { m: method, ran: true });
    }
    assert.equal((await group.inject('/v/boom')).status, 500);
    assert.equal(handled, true);
  });

  it('requireSchemas vale também para rotas manuais', () => {
    @Router('/s')
    class S {
      @Middlewares(trail('x')) noSchema() {
        return 1;
      }
    }
    assert.throws(
      () =>
        createApp({ requireSchemas: true })
          .mount(S, { auto: false })
          .get('/', (r) => r.noSchema),
      /requireSchemas: S: GET \/s\/ has no response schema/,
    );
  });
});

// ---------- Checagens de tipo ----------
function _types() {
  const app = createApp();
  app
    .mount(UserRoutes)
    .get('/a', (r) => r.getUser)
    .post('/b', (r) => r.exportCsv, { guards: [] });
  // @ts-expect-error: método inexistente na classe
  app.mount(UserRoutes).get('/c', (r) => r.nope);
  // @ts-expect-error: o seletor precisa devolver um método, não um valor
  app.mount(new UserRoutes()).get('/d', () => 42);
  // @ts-expect-error: opção desconhecida na rota manual
  app.mount(UserRoutes).get('/e', (r) => r.getUser, { prefix: '/x' });
}
void _types;

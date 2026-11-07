import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { type Context, createApp, Get, RequestAbortedError, type ResponseInfo, type RouteInfo, Router } from 'sashiko';

@Router('/users')
class UserRoutes {
  @Get('/:id') getUser(ctx: Context) {
    return { route: ctx.route };
  }
}

/** Lê o `route` devolvido pelo handler de teste. */
const routeOf = (res: { json(): unknown }) => (res.json() as { route: RouteInfo }).route;

/** Middleware global que lê o `ctx.route` depois do `next()` (modelo onion), inclusive em 404. */
function capture(seen: (RouteInfo | undefined)[]) {
  return async (ctx: Context, next: () => Promise<void>) => {
    await next();
    seen.push(ctx.route);
  };
}

describe('F-38 · ctx.route', () => {
  it('traz o template com o prefixo, a classe e o método, nunca o path recebido', async () => {
    const app = createApp({ logger: false, shutdown: false });
    app.group({ prefix: '/v1' }, (g) => g.mount(UserRoutes));
    const res = await app.inject('/v1/users/42');
    assert.deepEqual(routeOf(res), { method: 'GET', path: '/v1/users/:id', owner: 'UserRoutes', handler: 'getUser' });
  });

  it('a mesma classe montada duas vezes tem o template de cada montagem', async () => {
    const app = createApp({ logger: false, shutdown: false });
    app.group({ prefix: '/v1' }, (g) => g.mount(UserRoutes));
    app.mount(UserRoutes, { prefix: '/clientes' });
    assert.equal(routeOf(await app.inject('/clientes/1')).path, '/clientes/:id');
    assert.equal(routeOf(await app.inject('/v1/users/1')).path, '/v1/users/:id');
  });

  it('host: traz a regra que venceu, não o hostname do cliente', async () => {
    const app = createApp({ logger: false, shutdown: false });
    app.group({ host: ['*.exemplo.com', 'admin.test'] }, (g) => g.mount(UserRoutes));
    app.mount(UserRoutes, { prefix: '/any' });

    const tenant = await app.inject({ url: '/users/1', headers: { host: 'acme.exemplo.com' } });
    assert.equal(routeOf(tenant).host, '*.exemplo.com');
    const admin = await app.inject({ url: '/users/1', headers: { host: 'admin.test' } });
    assert.equal(routeOf(admin).host, 'admin.test');
    const anyHost = await app.inject({ url: '/any/1', headers: { host: 'outro.dev' } });
    assert.equal('host' in routeOf(anyHost), false);
  });

  it('undefined em 404 e 405; estáticos e rotas manuais também são identificados', async () => {
    const seen: (RouteInfo | undefined)[] = [];
    const app = createApp({ logger: false, shutdown: false });
    app.use(capture(seen));
    app.mount(UserRoutes).get('/perfil/:id', (r) => r.getUser);
    app.static('/assets', fileURLToPath(new URL('../fixtures', import.meta.url)));
    await app.inject('/nada');
    await app.inject({ method: 'DELETE', url: '/users/1' });
    await app.inject('/users/perfil/7');
    assert.equal((await app.inject('/assets/tls/README.md')).status, 200);
    assert.equal(seen[0], undefined, '404');
    assert.equal(seen[1], undefined, '405');
    assert.deepEqual(seen[2], { method: 'GET', path: '/users/perfil/:id', owner: 'UserRoutes', handler: 'getUser' });
    assert.equal(seen[3]?.path, '/assets/*');
    assert.equal(seen[3]?.owner, 'static');
  });

  it('é imutável: uma requisição não altera o que a próxima vê', async () => {
    @Router('/x')
    class X {
      @Get('/') x(ctx: Context) {
        assert.throws(() => {
          (ctx.route as { path: string }).path = '/hack';
        }, TypeError);
        return { path: ctx.route?.path };
      }
    }
    const app = createApp({ logger: false, shutdown: false });
    app.mount(X);
    // `@Get('/')` em `@Router('/x')` é registrada como `/x/`: o template é o registrado.
    assert.equal(((await app.inject('/x')).json() as { path: string }).path, '/x/');
    assert.equal(((await app.inject('/x')).json() as { path: string }).path, '/x/');
  });
});

describe('F-38 · motivo tipado do cancelamento', () => {
  it('desconexão do cliente: RequestAbortedError com CLIENT_DISCONNECTED (mensagem de antes)', async () => {
    let reason: unknown;
    let code: string | undefined;
    let done!: () => void;
    const aborted = new Promise<void>((r) => (done = r));
    @Router('/')
    class R {
      @Get('/slow') slow(ctx: Context) {
        ctx.signal.addEventListener('abort', () => {
          reason = ctx.signal.reason;
          code = ctx.abortReason;
          done();
        });
        return new Promise(() => {}); // nunca responde: o cliente desiste
      }
    }
    const app = createApp({ logger: false, shutdown: false });
    app.mount(R);
    const server = await app.listen(0);
    try {
      const req = http.get({ port: (server.address() as AddressInfo).port, path: '/slow' });
      req.on('error', () => {});
      setTimeout(() => req.destroy(), 30);
      await aborted;
      assert.ok(reason instanceof RequestAbortedError);
      assert.equal(reason.code, 'CLIENT_DISCONNECTED');
      assert.equal(reason.message, 'client disconnected');
      assert.equal(code, 'CLIENT_DISCONNECTED');
    } finally {
      await app.close(500);
    }
  });

  it('close() do app: os streams abertos recebem SHUTDOWN', async () => {
    let code: string | undefined;
    @Router('/')
    class R {
      @Get('/sse') sse(ctx: Context) {
        ctx.sse().send({ data: 'oi' });
        ctx.signal.addEventListener('abort', () => (code = ctx.abortReason));
      }
    }
    const app = createApp({ logger: false, shutdown: false });
    app.mount(R);
    const server = await app.listen(0);
    await new Promise<void>((resolve) => {
      http.get({ port: (server.address() as AddressInfo).port, path: '/sse' }, (res) => {
        res.once('data', () => resolve());
        res.resume();
      });
    });
    await app.close(2_000);
    assert.equal(code, 'SHUTDOWN');
  });

  it('sem cancelamento, abortReason é undefined', async () => {
    @Router('/')
    class R {
      @Get('/ok') ok(ctx: Context) {
        return { code: ctx.abortReason ?? null };
      }
    }
    const app = createApp({ logger: false, shutdown: false });
    app.mount(R);
    assert.deepEqual((await app.inject('/ok')).json(), { code: null });
  });
});

describe('F-38 · onRequest e onResponse: exatamente uma vez em todos os caminhos', () => {
  const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

  @Router('/')
  class Paths {
    @Get('/ok') ok() {
      return { ok: true };
    }
    @Get('/boom') boom() {
      throw new Error('falhou');
    }
    @Get('/stream') stream() {
      return Readable.from(['a', 'b']);
    }
    @Get('/sse') sse(ctx: Context) {
      const s = ctx.sse();
      s.send({ data: 'oi' });
      s.close();
    }
    @Get('/hang') hang() {
      return new Promise(() => {});
    }
    @Get('/hold') hold(ctx: Context) {
      ctx.sse().send({ data: 'aberto' });
    }
  }

  function observed(opts: Parameters<typeof createApp>[0] = {}) {
    const starts: string[] = [];
    const ends: { path: string; info: ResponseInfo }[] = [];
    const app = createApp({ logger: false, shutdown: false, ...opts });
    app.onRequest((ctx) => void starts.push(ctx.path));
    app.onResponse((ctx, info) => void ends.push({ path: ctx.path, info }));
    app.mount(Paths).health();
    const end = (path: string) => {
      const found = ends.filter((e) => e.path === path);
      assert.equal(found.length, 1, `onResponse exatamente uma vez em ${path} (vieram ${found.length})`);
      assert.equal(starts.filter((p) => p === path).length, 1, `onRequest exatamente uma vez em ${path}`);
      return found[0]!.info;
    };
    return { app, end, starts, ends };
  }

  it('inject: sucesso, erro, 404, healthcheck, stream, SSE', async () => {
    const { app, end } = observed({ allowedHosts: ['api.test'] });
    const h = { host: 'api.test' };
    await app.inject({ url: '/ok', headers: h });
    await app.inject({ url: '/boom', headers: h });
    await app.inject({ url: '/nada', headers: h });
    await app.inject({ url: '/livez', headers: h });
    await app.inject({ url: '/stream', headers: h });
    await app.inject({ url: '/sse', headers: h });
    await tick(20);

    const ok = end('/ok');
    assert.equal(ok.outcome, 'completed');
    assert.equal(ok.status, 200);
    assert.equal(ok.streaming, false);
    assert.equal(ok.route?.path, '/ok');
    assert.ok(ok.ttfbMs !== undefined && ok.ttfbMs <= ok.ms, 'ttfbMs até os headers, no máximo a duração');

    const boom = end('/boom');
    assert.equal(boom.outcome, 'error');
    assert.equal(boom.status, 500);
    assert.equal((boom.error as Error).message, 'falhou');

    assert.equal(end('/nada').status, 404);
    assert.equal(end('/nada').outcome, 'completed');
    assert.equal(end('/nada').route, undefined);
    assert.equal(end('/livez').route, undefined);
    assert.equal(end('/stream').streaming, true);
    assert.equal(end('/sse').streaming, true);
    assert.equal(end('/sse').outcome, 'completed');
  });

  it('o 405 e o Host inválido também passam pelos dois hooks', async () => {
    const { app, ends, starts } = observed({ allowedHosts: ['api.test'] });
    await app.inject({ method: 'DELETE', url: '/ok', headers: { host: 'api.test' } });
    await app.inject({ url: '/ok', headers: { host: 'evil.test' } });
    await tick(20);
    assert.deepEqual(
      ends.map((e) => e.info.status),
      [405, 400],
    );
    assert.equal(starts.length, 2);
  });

  it('rede real: cancelamento pelo cliente e shutdown com stream aberto', async () => {
    const { app, end } = observed();
    const server = await app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const req = http.get({ port, path: '/hang' });
    req.on('error', () => {});
    await tick(30);
    req.destroy();
    await new Promise<void>((resolve) => {
      http.get({ port, path: '/hold' }, (res) => {
        res.once('data', () => resolve());
        res.resume();
      });
    });
    await tick(30);
    await app.close(2_000);
    await tick(20);

    const hang = end('/hang');
    assert.equal(hang.outcome, 'aborted');
    assert.equal(hang.abortReason, 'CLIENT_DISCONNECTED');
    const hold = end('/hold');
    assert.equal(hold.outcome, 'aborted');
    assert.equal(hold.abortReason, 'SHUTDOWN');
    assert.equal(hold.streaming, true);
    assert.ok(hold.ttfbMs !== undefined && hold.ttfbMs < hold.ms, 'no stream, ttfbMs é bem menor que a duração');
  });

  it('um hook que lança (ou rejeita) é logado e não afeta a resposta nem os outros', async () => {
    const errors: string[] = [];
    const logger = {
      info() {},
      warn() {},
      debug() {},
      error(_obj: unknown, msg?: string) {
        errors.push(String(msg));
      },
      child() {
        return logger;
      },
    };
    let reached = 0;
    const app = createApp({ logger, shutdown: false });
    app.onRequest(() => {
      throw new Error('x');
    });
    app.onRequest((() => Promise.reject(new Error('y'))) as never);
    app.onResponse(() => {
      throw new Error('z');
    });
    app.onResponse(() => void reached++);
    app.mount(Paths);
    assert.equal((await app.inject('/ok')).status, 200);
    await tick(20);
    assert.equal(reached, 1);
    assert.deepEqual(errors.sort(), ['onRequest hook failed', 'onRequest hook failed', 'onResponse hook failed']);
  });

  it('sem hooks nem logRequests, a resposta não é instrumentada', async () => {
    const app = createApp({ logger: false, shutdown: false });
    let wrapped: boolean | undefined;
    app.use(async (ctx, next) => {
      wrapped = Object.hasOwn(ctx.res, 'writeHead');
      await next();
    });
    app.mount(Paths);
    await app.inject('/ok');
    assert.equal(wrapped, false);
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { describe, it, mock } from 'node:test';
import { type Context, createApp, Get, Router } from 'flowingts';

@Router('/')
class Ready {
  @Get('/readyz') r() {
    return 'mine';
  }
}
@Router('/')
class Spec {
  @Get('/openapi.json/') s() {
    return 'mine';
  }
}
@Router('/')
class Plain {
  @Get('/x') x() {
    return 'x';
  }
}

describe('0.11.3 · rotas do framework não encobrem rotas do usuário', () => {
  it('health() depois de uma rota com o mesmo path: erro com a rota na mensagem', () => {
    assert.throws(() => createApp().mount(Ready).health(), /app\.health\(\): path "\/readyz" would shadow Ready\.r/);
  });

  it('rota registrada depois do health() ou do openapi(): erro, inclusive com barra final', () => {
    assert.throws(() => createApp().health().mount(Ready), /GET \/readyz is served by app\.health\(\)/);
    assert.throws(() => createApp().openapi().mount(Spec), /served by app\.openapi\(\)/);
    assert.doesNotThrow(() => createApp().openapi({ docs: true }).health().mount(Plain), 'paths distintos passam');
  });

  it('health() e openapi() com o mesmo path: erro; com paths próprios, os dois convivem com a rota', () => {
    assert.throws(() => createApp().openapi({ path: '/readyz' }).health(), /already used by app\.openapi\(\)/);
    assert.throws(() => createApp().health({ live: '/spec' }).openapi({ path: '/spec/' }), /already used by app\.health\(\)/);
    assert.doesNotThrow(() => createApp().mount(Ready).health({ ready: '/ready' }).openapi({ path: '/spec.json' }));
  });

  it('chamar health() de novo substitui a configuração anterior sem conflitar com ela', () => {
    assert.doesNotThrow(() => createApp().health().health({ checks: {} }));
  });
});

describe('0.11.3 · healthchecks e allowedHosts', () => {
  const app = createApp({ logger: false, allowedHosts: ['api.exemplo.com'] })
    .mount(Plain)
    .health();

  it('sondas com o IP do pod no Host recebem resposta; o resto continua 400', async () => {
    assert.equal((await app.inject({ url: '/readyz', headers: { host: '10.1.2.3:3000' } })).status, 200);
    assert.equal((await app.inject({ url: '/livez', headers: { host: '10.1.2.3:3000' } })).status, 200);
    assert.equal((await app.inject({ url: '/x', headers: { host: '10.1.2.3:3000' } })).status, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/readyz', headers: { host: '10.1.2.3' } })).status, 400, 'só GET/HEAD');
  });

  it('Host malformado continua 400, e anyHost: false volta ao comportamento estrito', async () => {
    assert.equal((await app.inject({ url: '/readyz', headers: { host: 'a b' } })).status, 400);
    const strict = createApp({ logger: false, allowedHosts: ['api.exemplo.com'] }).health({ anyHost: false });
    assert.equal((await strict.inject({ url: '/readyz', headers: { host: '10.1.2.3' } })).status, 400);
    assert.equal((await strict.inject({ url: '/readyz', headers: { host: 'api.exemplo.com' } })).status, 200);
  });
});

describe('0.11.3 · barra final nas rotas do framework', () => {
  it('/readyz/, /livez/, /openapi.json/ e /docs/ respondem como as rotas normais', async () => {
    const app = createApp({ logger: false }).mount(Plain).health().openapi({ docs: true });
    for (const url of ['/readyz/', '/livez/', '/openapi.json/', '/docs/']) {
      assert.equal((await app.inject(url)).status, 200, url);
    }
  });
});

describe('0.11.3 · reloadTLS() adicionando sni', () => {
  it('funciona mesmo que o listen() não tivesse sni', async () => {
    const f = (n: string) => readFileSync(new URL(`../fixtures/tls/${n}`, import.meta.url));
    const cert = (n: string) => ({ key: f(`${n}.key`), cert: f(`${n}.crt`) });
    const ca = ['default', 'api'].map((n) => f(`${n}.crt`));
    const app = createApp({ logger: false, shutdown: false }).mount(Plain);
    const server = await app.listen({ port: 0, tls: cert('default') });
    const cn = (servername: string) =>
      new Promise<string>((resolve, reject) => {
        const req = https.request(
          {
            host: '127.0.0.1',
            port: (server.address() as AddressInfo).port,
            path: '/x',
            servername,
            ca,
            agent: false,
            checkServerIdentity: () => undefined,
          },
          (res) => {
            resolve(String((res.socket as TLSSocket).getPeerCertificate().subject.CN));
            res.resume();
          },
        );
        req.on('error', reject);
        req.end();
      });
    try {
      assert.equal(await cn('api.test'), 'localhost');
      app.reloadTLS({ ...cert('default'), sni: { 'api.test': cert('api') } });
      assert.equal(await cn('api.test'), 'api.test');
      assert.equal(await cn('outro.test'), 'localhost');
    } finally {
      await app.close();
    }
  });
});

describe('0.11.4 · health() e openapi() dentro de um group()', () => {
  it('são recusados dentro do callback, e o grupo é desfeito', async () => {
    const app = createApp({ logger: false });
    assert.throws(
      () =>
        app.group({}, (g) => {
          g.mount(Ready);
          app.health();
        }),
      /cannot be called inside an app\.group\(\) callback/,
    );
    assert.throws(
      () =>
        app.group({}, (g) => {
          g.mount(Plain);
          app.openapi();
        }),
      /cannot be called inside/,
    );
    assert.equal((await app.inject('/readyz')).status, 404, 'nem a rota nem o healthcheck ficaram');
    assert.equal((await app.inject('/x')).status, 404);
    assert.equal((await app.inject('/openapi.json')).status, 404);
  });

  it('um grupo que falha não deixa configuração parcial', async () => {
    const app = createApp({ logger: false });
    assert.throws(
      () =>
        app.group({}, (g) => {
          g.mount(Plain);
          throw new Error('falhou');
        }),
      /falhou/,
    );
    app.health();
    assert.equal((await app.inject('/x')).status, 404);
    assert.equal((await app.inject('/livez')).status, 200);
  });

  it('fora do grupo, as duas ordens continuam detectando o conflito com a rota do grupo', () => {
    assert.throws(
      () =>
        createApp()
          .group({}, (g) => g.mount(Ready))
          .health(),
      /would shadow Ready\.r/,
    );
    assert.throws(
      () =>
        createApp()
          .health()
          .group({}, (g) => g.mount(Ready)),
      /served by app\.health\(\)/,
    );
  });
});

describe('0.12.1 · costuras dos estáticos, do sendFile e do inject', () => {
  const dir = new URL('../fixtures/tls/', import.meta.url).pathname;

  it('static() funciona com requireSchemas: true', async () => {
    const app = createApp({ logger: false, requireSchemas: true }).static('/s', dir);
    assert.equal((await app.inject('/s/README.md')).status, 200);
  });

  it('ctx.sendFile() sem await/return: o app espera o envio, e o 404 vira resposta, não unhandledRejection', async () => {
    const unhandled = mock.fn();
    process.on('unhandledRejection', unhandled);
    try {
      @Router('/')
      class F {
        @Get('/ok') ok(ctx: Context) {
          ctx.sendFile('README.md', { root: dir });
        }
        @Get('/missing') missing(ctx: Context) {
          ctx.sendFile('nao-existe.md', { root: dir });
        }
      }
      const app = createApp({ logger: false }).mount(F);
      const ok = await app.inject('/ok');
      assert.equal(ok.status, 200);
      assert.match(ok.body, /autoassinados/);
      assert.equal((await app.inject('/missing')).status, 404);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(unhandled.mock.callCount(), 0);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('inject() dispara onResponse e logRequests, como uma conexão real', async () => {
    const seen: string[] = [];
    const info = mock.fn();
    const log = {
      debug() {},
      info,
      warn() {},
      error() {},
      child() {
        return log;
      },
    };
    const app = createApp({ logger: log, logRequests: true })
      .mount(Plain)
      .onResponse((ctx, i) => {
        seen.push(`${ctx.path}:${i.status}`);
      });
    await app.inject('/x');
    await app.inject('/nada');
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(seen, ['/x:200', '/nada:404']);
    assert.equal(info.mock.calls.filter((c) => c.arguments[1] === 'request completed').length, 2);
  });
});

describe('fase 4 · desconexão do cliente não é erro (P-12)', () => {
  it('cliente que desiste de um download grande gera log debug, não error', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const http = await import('node:http');
    const dirTmp = mkdtempSync(join(tmpdir(), 'flowing-p12-'));
    writeFileSync(join(dirTmp, 'big.bin'), Buffer.alloc(20 * 1024 * 1024));
    const levels: string[] = [];
    const log = {
      debug: (_o: unknown, m?: string) => {
        levels.push(`debug:${m}`);
      },
      info() {},
      warn() {},
      error: (_o: unknown, m?: string) => {
        levels.push(`error:${m}`);
      },
      child() {
        return log;
      },
    };
    const app = createApp({ logger: log, shutdown: false }).static('/s', dirTmp);
    const server = await app.listen(0);
    try {
      await new Promise<void>((resolve) => {
        const req = http.get({ port: (server.address() as { port: number }).port, path: '/s/big.bin' }, (res) => {
          res.once('data', () => {
            req.destroy();
            setTimeout(resolve, 100);
          });
        });
        req.on('error', () => {});
      });
      assert.ok(!levels.some((l) => l.startsWith('error:')), levels.join(' | '));
    } finally {
      await app.close();
      rmSync(dirTmp, { recursive: true, force: true });
    }
  });
});

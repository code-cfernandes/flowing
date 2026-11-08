import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { describe, it } from 'node:test';
import { type Context, createApp, Get, Router } from 'flowingts';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/tls/${name}`, import.meta.url));
const cert = (name: string) => ({ key: fixture(`${name}.key`), cert: fixture(`${name}.crt`) });
const ca = ['default', 'api', 'wild', 'renewed'].map((n) => fixture(`${n}.crt`));

@Router('/')
class Echo {
  @Get('/') info(ctx: Context) {
    ctx.setCookie('sid', '1');
    return { protocol: ctx.protocol, host: ctx.host };
  }
}

interface Result {
  status: number;
  body: string;
  cn: string;
  fingerprint: string;
  protocol: string | null;
}

/** Requisição HTTPS em conexão nova (sem keep-alive), com o SNI informado. */
function get(port: number, servername = 'localhost', extra: https.RequestOptions = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: '127.0.0.1', port, path: '/', servername, ca, agent: false, headers: { host: servername }, ...extra },
      (res) => {
        const socket = res.socket as TLSSocket;
        const peer = socket.getPeerCertificate();
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({
            status: res.statusCode!,
            body,
            cn: String(peer.subject?.CN),
            fingerprint: peer.fingerprint256,
            protocol: socket.getProtocol(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const portOf = (server: { address(): unknown }) => (server.address() as AddressInfo).port;

describe('listen({ tls })', () => {
  it('sobe em HTTPS com TLS 1.2+, os timeouts do app e ctx.protocol https', async () => {
    const app = createApp({ logger: false, shutdown: false }).mount(Echo);
    const server = await app.listen({ port: 0, tls: cert('default') });
    try {
      assert.ok(server instanceof https.Server);
      assert.equal(server.requestTimeout, 30_000);
      assert.equal(server.headersTimeout, 10_000);
      const res = await get(portOf(server));
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(res.body), { protocol: 'https', host: 'localhost' });
      assert.equal(res.cn, 'localhost');
      assert.match(String(res.protocol), /^TLSv1\.[23]$/);
      await assert.rejects(get(portOf(server), 'localhost', { maxVersion: 'TLSv1.1', minVersion: 'TLSv1' }));
    } finally {
      await app.close();
    }
  });

  it('minVersion TLSv1.3 recusa clientes TLS 1.2', async () => {
    const app = createApp({ logger: false, shutdown: false }).mount(Echo);
    const server = await app.listen({ port: 0, tls: { ...cert('default'), minVersion: 'TLSv1.3' } });
    try {
      assert.equal((await get(portOf(server))).protocol, 'TLSv1.3');
      await assert.rejects(get(portOf(server), 'localhost', { maxVersion: 'TLSv1.2' }));
    } finally {
      await app.close();
    }
  });

  it('SNI: certificado por domínio, curinga de um nível e o principal para o resto', async () => {
    const app = createApp({ logger: false, shutdown: false }).mount(Echo);
    const server = await app.listen({
      port: 0,
      tls: { ...cert('default'), sni: { 'API.test': cert('api'), '*.wild.test': cert('wild') } },
    });
    const port = portOf(server);
    try {
      assert.equal((await get(port, 'api.test')).cn, 'api.test');
      assert.equal((await get(port, 'a.wild.test')).cn, '*.wild.test');
      // a.b.wild.test não é coberto pelo curinga: recebe o principal, que o cliente recusa (nome não confere).
      await assert.rejects(get(port, 'a.b.wild.test'), /altnames|Hostname/i);
      assert.equal((await get(port, 'localhost')).cn, 'localhost');
    } finally {
      await app.close();
    }
  });

  it('só com sni, domínio desconhecido não completa o handshake', async () => {
    const app = createApp({ logger: false, shutdown: false }).mount(Echo);
    const server = await app.listen({ port: 0, tls: { sni: { 'api.test': cert('api') } } });
    try {
      assert.equal((await get(portOf(server), 'api.test')).status, 200);
      await assert.rejects(get(portOf(server), 'outro.test'));
    } finally {
      await app.close();
    }
  });

  it('configuração inválida falha no listen()', async () => {
    const app = createApp({ logger: false, shutdown: false }).mount(Echo);
    await assert.rejects(app.listen({ port: 0, tls: {} }), /needs a certificate/);
    await assert.rejects(app.listen({ port: 0, tls: { ...cert('default'), minVersion: 'TLSv1.1' as 'TLSv1.2' } }), /minVersion/);
    await assert.rejects(app.listen({ port: 0, tls: { key: 'lixo', cert: 'lixo' } }));
    await assert.rejects(app.listen({ port: 0, tls: { sni: { 'api.test': {} } } }), /needs \{ key, cert \}/);
    await assert.rejects(app.listen({ port: 0, tls: { sni: { 'a b': cert('api') } } }), /invalid domain/);
    await assert.rejects(app.listen({ port: 0, tls: { sni: { 'a.*.test': cert('api') } } }), /invalid domain/);
  });
});

describe('app.reloadTLS()', () => {
  it('troca o certificado sem reiniciar; conexões novas usam o novo', async () => {
    const app = createApp({ logger: false, shutdown: false }).mount(Echo);
    const server = await app.listen({ port: 0, tls: { ...cert('default'), sni: { 'api.test': cert('api') } } });
    const port = portOf(server);
    try {
      const before = await get(port);
      app.reloadTLS({ ...cert('renewed'), sni: { 'api.test': cert('renewed') } });
      const after = await get(port);
      assert.notEqual(after.fingerprint, before.fingerprint);
      assert.equal(after.status, 200);
      assert.equal((await get(port, 'api.test', { checkServerIdentity: () => undefined })).fingerprint, after.fingerprint);
    } finally {
      await app.close();
    }
  });

  it('certificado inválido lança erro e mantém os atuais', async () => {
    const app = createApp({ logger: false, shutdown: false }).mount(Echo);
    const server = await app.listen({ port: 0, tls: cert('default') });
    try {
      const before = await get(portOf(server));
      assert.throws(() => app.reloadTLS({ key: 'lixo', cert: 'lixo' }));
      assert.equal((await get(portOf(server))).fingerprint, before.fingerprint);
    } finally {
      await app.close();
    }
  });

  it('sem listen({ tls }), reloadTLS lança erro', async () => {
    const app = createApp({ logger: false, shutdown: false }).mount(Echo);
    assert.throws(() => app.reloadTLS(cert('default')), /not listening with \{ tls \}/);
    await app.listen(0);
    try {
      assert.throws(() => app.reloadTLS(cert('default')), /not listening with \{ tls \}/);
    } finally {
      await app.close();
    }
  });
});

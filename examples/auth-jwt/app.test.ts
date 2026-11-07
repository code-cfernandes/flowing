import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from './app.ts';
import { signToken, verifyToken } from './jwt.ts';
import { UserStore } from './users.ts';

const SECRET = 'segredo-de-teste-com-pelo-menos-32-caracteres';

describe('exemplo auth-jwt', () => {
  const users = new UserStore();
  users.add({ id: '1', email: 'ana@exemplo.com', role: 'admin' }, 'senha-da-ana');
  users.add({ id: '2', email: 'bia@exemplo.com', role: 'user' }, 'senha-da-bia');
  const app = buildApp(users, SECRET);
  const json = { 'content-type': 'application/json' };
  const login = (email: string, password: string) =>
    app.inject({ method: 'POST', url: '/auth/login', headers: json, body: { email, password } });
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  it('login: senha errada e e-mail inexistente têm a mesma resposta', async () => {
    const wrong = await login('ana@exemplo.com', 'errada');
    const unknown = await login('ninguem@exemplo.com', 'qualquer');
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    const fields = (r: typeof wrong) => {
      const { title, detail, code } = r.json<{ title: string; detail: string; code: string }>();
      return { title, detail, code };
    };
    assert.deepEqual(fields(wrong), fields(unknown));
    assert.equal(fields(wrong).detail, 'invalid credentials');
  });

  it('o token do login abre /me; o guard de papel barra quem não é admin', async () => {
    const ana = (await login('ana@exemplo.com', 'senha-da-ana')).json<{ token: string; expiresIn: number }>();
    assert.equal(ana.expiresIn, 900);
    assert.deepEqual((await app.inject({ url: '/me', headers: bearer(ana.token) })).json(), { id: '1', role: 'admin' });
    assert.equal((await app.inject({ url: '/me/admin/report', headers: bearer(ana.token) })).status, 200);

    const bia = (await login('bia@exemplo.com', 'senha-da-bia')).json<{ token: string }>();
    assert.equal((await app.inject({ url: '/me/admin/report', headers: bearer(bia.token) })).status, 403);
  });

  it('sem token, token adulterado, expirado ou de outra chave: 401 com WWW-Authenticate', async () => {
    const none = await app.inject('/me');
    assert.equal(none.status, 401);
    assert.match(String(none.headers['www-authenticate']), /^Bearer/);

    const valid = signToken({ sub: '2', role: 'user' }, SECRET);
    const [h, p, s] = valid.split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ sub: '2', role: 'admin', iat: 0, exp: 9e9 })).toString('base64url');
    const cases = {
      adulterado: `${h}.${forged}.${s}`,
      expirado: signToken({ sub: '2', role: 'user' }, SECRET, -1),
      'outra chave': signToken({ sub: '2', role: 'user' }, 'outra-chave-qualquer-com-32-caracteres!'),
      'alg none': `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`,
      lixo: 'não-é-um-jwt',
    };
    for (const [name, token] of Object.entries(cases)) {
      assert.equal((await app.inject({ url: '/me', headers: bearer(token) })).status, 401, name);
    }
  });

  it('verifyToken respeita o exp', () => {
    const token = signToken({ sub: '1', role: 'user' }, SECRET, 60, 1_000_000);
    assert.ok(verifyToken(token, SECRET, 1_000_000 + 59_000));
    assert.equal(verifyToken(token, SECRET, 1_000_000 + 61_000), undefined);
  });
});

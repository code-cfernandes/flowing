import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileHostMatcher, compileOriginMatcher, normalizeOrigin, toFullMatch } from '../../src/utils/origin-match.ts';

const accepts = (m: (o: string) => boolean, list: string[]) => {
  for (const o of list) assert.equal(m(o), true, `deveria aceitar ${o}`);
};
const rejects = (m: (o: string) => boolean, list: string[]) => {
  for (const o of list) assert.equal(m(o), false, `deveria recusar ${o}`);
};

describe('origin-match · origens (CORS)', () => {
  it('string: igualdade depois de normalizar esquema, host e porta padrão', () => {
    const m = compileOriginMatcher(['https://App.Exemplo.com:443/']);
    accepts(m, ['https://app.exemplo.com', 'https://APP.exemplo.com', 'https://app.exemplo.com:443']);
    rejects(m, [
      'http://app.exemplo.com', // esquema diferente
      'https://app.exemplo.com:8443', // porta diferente
      'https://app.exemplo.com.atacante.com', // sufixo
      'https://evilapp.exemplo.com', // prefixo
      'https://sub.app.exemplo.com', // subdomínio não listado
      'null',
      'não é uma url',
      '',
    ]);
  });

  it('curinga: só subdomínios, com esquema e porta exatos', () => {
    const m = compileOriginMatcher(['https://*.exemplo.dev']);
    accepts(m, ['https://preview.exemplo.dev', 'https://a.b.exemplo.dev', 'https://X.EXEMPLO.dev']);
    rejects(m, [
      'https://exemplo.dev', // o domínio em si
      'https://exemplo.dev.atacante.com',
      'https://atacanteexemplo.dev', // sem o ponto separador
      'http://preview.exemplo.dev',
      'https://preview.exemplo.dev:8443',
    ]);
  });

  it('RegExp: precisa casar a origem inteira, mesmo sem âncoras', () => {
    const m = compileOriginMatcher([/https:\/\/app\.exemplo\.com/, /\.exemplo\.dev$/]);
    accepts(m, ['https://app.exemplo.com']);
    rejects(m, ['https://app.exemplo.com.atacante.com', 'https://xhttps://app.exemplo.com', 'https://preview.exemplo.dev']);
  });

  it('RegExp com flags g, y e m: resultado estável em chamadas seguidas', () => {
    const m = compileOriginMatcher([/https:\/\/app\.exemplo\.com/g, /https:\/\/b\.exemplo\.com/y, /https:\/\/c\.exemplo\.com/m]);
    for (let i = 0; i < 5; i++) {
      accepts(m, ['https://app.exemplo.com', 'https://b.exemplo.com', 'https://c.exemplo.com']);
    }
    rejects(m, ['https://x.com\nhttps://c.exemplo.com']);
  });

  it('RegExp com alternância continua ancorada nas duas pontas', () => {
    const re = toFullMatch(/https:\/\/a\.com|https:\/\/b\.com/);
    assert.equal(re.test('https://a.com'), true);
    assert.equal(re.test('https://b.com'), true);
    assert.equal(re.test('https://a.com.atacante.com'), false);
    assert.equal(re.test('https://atacante.com/https://b.com'), false);
  });

  it("origem 'null' só passa se listada explicitamente", () => {
    assert.equal(compileOriginMatcher(['https://a.com'])('null'), false);
    assert.equal(compileOriginMatcher(['null'])('null'), true);
  });

  it('IDN na regra é normalizado para punycode', () => {
    assert.equal(compileOriginMatcher(['https://exämple.com'])('https://xn--exmple-cua.com'), true);
  });

  it('regras inválidas falham na configuração, com mensagem clara', () => {
    assert.throws(() => compileOriginMatcher(['app.exemplo.com']), /use the full origin with scheme/);
    assert.throws(() => compileOriginMatcher(['https://app.*.com']), /only allowed as the first label/);
    assert.throws(() => compileOriginMatcher(['*']), /use origin: '\*'/);
  });

  it('normalizeOrigin', () => {
    assert.equal(normalizeOrigin('HTTPS://A.com:443/path?x'), 'https://a.com');
    assert.equal(normalizeOrigin('lixo'), undefined);
    assert.equal(normalizeOrigin('null'), 'null');
  });
});

describe('origin-match · hosts (allowedHosts)', () => {
  it('string sem porta aceita qualquer porta; com porta, exige a porta exata', () => {
    const m = compileHostMatcher(['api.exemplo.com', 'admin.exemplo.com:8443']);
    assert.equal(m('api.exemplo.com', 'api.exemplo.com:3000'), true);
    assert.equal(m('admin.exemplo.com', 'admin.exemplo.com:8443'), true);
    assert.equal(m('admin.exemplo.com', 'admin.exemplo.com'), false);
    assert.equal(m('api.exemplo.com.atacante.com', 'api.exemplo.com.atacante.com'), false);
  });

  it('curinga *.dominio: só subdomínios', () => {
    const m = compileHostMatcher(['*.exemplo.dev']);
    assert.equal(m('a.exemplo.dev', 'a.exemplo.dev'), true);
    assert.equal(m('exemplo.dev', 'exemplo.dev'), false);
    assert.equal(m('exemplo.dev.atacante.com', 'exemplo.dev.atacante.com'), false);
    assert.equal(m('atacanteexemplo.dev', 'atacanteexemplo.dev'), false);
  });

  it('RegExp precisa casar o hostname inteiro, com flags g/y estáveis', () => {
    const m = compileHostMatcher([/api\.exemplo\.com/g, /preview\.exemplo\.dev/y]);
    for (let i = 0; i < 5; i++) {
      assert.equal(m('api.exemplo.com', 'api.exemplo.com'), true);
      assert.equal(m('preview.exemplo.dev', 'preview.exemplo.dev'), true);
    }
    assert.equal(m('evil-preview.exemplo.dev', 'evil-preview.exemplo.dev'), false, 'remover a flag y não pode ampliar o que é aceito');
    assert.equal(m('api.exemplo.com.atacante.com', 'api.exemplo.com.atacante.com'), false);
  });

  it('regras inválidas falham na configuração', () => {
    assert.throws(() => compileHostMatcher(['api.*.com']), /only allowed as "\*\.domain"/);
    assert.throws(() => compileHostMatcher(['https://api.exemplo.com']), /invalid allowedHosts rule/);
    assert.throws(() => compileHostMatcher(['api.exemplo.com/path']), /invalid allowedHosts rule/);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isJsonContentType, joinPaths, mediaType, parseQuery } from '../../src/utils/index.ts';

describe('utils/query · parseQuery', () => {
  const q = (s: string, max?: number) => parseQuery(new URLSearchParams(s), max);

  it('chave única vira string e repetida vira array', () => {
    assert.deepEqual(q('a=1&b=2&b=3&b=4'), { a: '1', b: ['2', '3', '4'] });
  });

  it('decodifica valores e trata + como espaço', () => {
    assert.deepEqual(q('name=Ana+Maria&city=S%C3%A3o%20Paulo'), { name: 'Ana Maria', city: 'São Paulo' });
  });

  it('descarta chaves perigosas', () => {
    assert.deepEqual(Object.keys(q('__proto__=1&constructor=2&prototype=3&ok=4')), ['ok']);
  });

  it('respeita maxKeys (padrão 1000)', () => {
    assert.deepEqual(q('a=1&b=2&c=3', 2), { a: '1', b: '2' });
    const many = Array.from({ length: 1500 }, (_, i) => `k${i}=v`).join('&');
    assert.equal(Object.keys(q(many)).length, 1000);
  });
});

describe('utils/content-type', () => {
  it('mediaType remove parâmetros e normaliza', () => {
    assert.equal(mediaType('Application/JSON; charset=utf-8'), 'application/json');
    assert.equal(mediaType(undefined), '');
  });

  it('isJsonContentType', () => {
    for (const ok of ['application/json', 'application/problem+json', 'application/vnd.api+json; charset=utf-8']) {
      assert.equal(isJsonContentType(ok), true, ok);
    }
    for (const no of [undefined, '', 'application/jsonx', 'text/json', 'text/plain; x=application/json', 'application/+json']) {
      assert.equal(isJsonContentType(no), false, String(no));
    }
  });
});

describe('utils/path · joinPaths', () => {
  it('junta com exatamente uma barra', () => {
    assert.equal(joinPaths('/users', '/:id'), '/users/:id');
    assert.equal(joinPaths('/users/', ':id'), '/users/:id');
    assert.equal(joinPaths('', '/'), '/');
    assert.equal(joinPaths('/', '/health'), '/health');
  });
});

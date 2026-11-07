/**
 * O caminho rápido de `splitRequestTarget` precisa dar exatamente o mesmo path e query que o WHATWG URL
 * (`parseRequestTarget`), inclusive nos alvos de ataque do S-09.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRequestTarget, splitRequestTarget } from '../../src/utils/request-target.ts';

function same(raw: string | undefined): void {
  const url = parseRequestTarget(raw);
  assert.deepEqual(splitRequestTarget(raw), { pathname: url.pathname, search: url.search }, `alvo: ${JSON.stringify(raw)}`);
}

describe('request-target · caminho rápido equivalente ao URL', () => {
  it('alvos de ataque e casos de borda', () => {
    const cases = [
      undefined,
      '',
      '/',
      '?',
      '/?',
      '/a?',
      '/a??',
      '/a?b?c',
      '/a#frag',
      '/a?x#f',
      '//evil.com/x',
      '///x',
      'http://outro/x?y=1',
      'https://evil.com/p?q',
      'HTTP://X/Y',
      'a/b',
      '*',
      '/a/../b',
      '/a/./b',
      '/..',
      '/.',
      '/a/..',
      '/a/.',
      '/.a',
      '/a.',
      '/a..b',
      '/...',
      '/%2e%2e/x',
      '/%2E/x',
      '/a%2fb',
      '/a\\b',
      '\\\\evil.com',
      '/a b',
      '/a"b',
      '/a<b>',
      '/a{b}',
      '/a^b',
      '/a|b',
      '/a`b',
      '/çã',
      '/a\tb',
      '/a\nb',
      '/a?b c',
      "/a?b'c",
      '/a?é',
      '/a?%zz',
      '/a?%20',
      '/a?<x>',
      '/a?"',
      '/a?#',
      '/a:b@c',
      "/a!$&'()*+,;=",
      '/a?!$&()*+,;=/:@?',
      '/a//b',
      '/a/',
      '/users/42/posts?page=2&sort=-date',
    ];
    for (const c of cases) same(c);
  });

  it('fuzz: 20 mil alvos aleatórios', () => {
    const alphabet = 'aZ09-._~/:@!$&\'()*+,;=?#%2eE\\ "<>{}|^`çé\t';
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 20_000; i++) {
      let s = rnd(4) === 0 ? '' : '/';
      const len = rnd(16);
      for (let j = 0; j < len; j++) s += alphabet[rnd(alphabet.length)];
      same(s);
    }
  });
});

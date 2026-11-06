import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Router, Get, Schema } from 'sashiko';
import { metadataFor } from '../../src/core/metadata.ts';

describe('R-01 · Symbol.metadata', () => {
  it('o shim garante Symbol.metadata ao importar sashiko', () => {
    assert.equal(typeof Symbol.metadata, 'symbol');
  });

  it('sem metadata no contexto, o erro explica como resolver', () => {
    assert.throws(
      () => metadataFor({ kind: 'class', metadata: undefined }, 'Router'),
      /@Router: decorator metadata is unavailable.*Import 'sashiko'/,
    );
  });
});

describe('R-02 · decorators legados (experimentalDecorators)', () => {
  // Simula como o TypeScript chama decorators com experimentalDecorators: (target, key, descriptor)
  const legacyCall = (decorator: (...args: any[]) => unknown) => () =>
    decorator({}, 'method', { value: () => {}, writable: true, configurable: true, enumerable: false });

  it('@Get legado gera erro orientando a remover experimentalDecorators', () => {
    assert.throws(legacyCall(Get('/')), /@Get received legacy decorator arguments.*experimentalDecorators/);
  });

  it('@Schema legado também é detectado', () => {
    assert.throws(legacyCall(Schema({})), /@Schema received legacy/);
  });

  it('@Controller legado (só o construtor) também é detectado', () => {
    assert.throws(() => (Router('/x') as (...a: any[]) => unknown)(class {}), /@Router received legacy/);
  });
});

describe('R-06 · src/ não usa o alias sashiko', () => {
  it('nenhum import em src/ aponta para "sashiko" (o tsc não reescreve paths)', async () => {
    const root = join(import.meta.dirname, '../../src');
    const files = (await readdir(root, { recursive: true })).filter((f) => f.endsWith('.ts'));
    const offenders: string[] = [];
    for (const f of files) {
      const src = await readFile(join(root, f), 'utf8');
      if (/from\s+['"]sashiko(\/[^'"]*)?['"]|import\(\s*['"]sashiko/.test(src)) offenders.push(f);
    }
    assert.deepEqual(offenders, []);
  });
});

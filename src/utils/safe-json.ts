/**
 * `JSON.parse` contra prototype pollution (S-08).
 *
 * O `JSON.parse` cria `"__proto__"` como propriedade própria, o que é inofensivo sozinho. O risco
 * aparece depois, quando o objeto passa por um merge recursivo ou por `Object.assign` em código do
 * usuário ou de bibliotecas. Por isso, o body é conferido logo na entrada:
 * - `__proto__` em qualquer nível;
 * - `constructor` cujo valor é um objeto com `prototype` (o outro caminho até o protótipo).
 *
 * A conferência só percorre o objeto quando o texto pode conter essas chaves, inclusive com escapes
 * `\u`. Bodies comuns seguem pelo caminho rápido.
 */

export type ProtoPoisoning = 'error' | 'remove';

export class ProtoPoisoningError extends Error {
  constructor(readonly key: string) {
    super(`Object contains forbidden key "${key}"`);
  }
}

export function parseJson(text: string, mode: ProtoPoisoning = 'error'): unknown {
  const value: unknown = JSON.parse(text);
  if (!text.includes('proto') && !text.includes('constructor') && !text.includes('\\u')) return value;
  scrub(value, mode);
  return value;
}

function scrub(root: unknown, mode: ProtoPoisoning): void {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== 'object' || node === null) continue;
    const obj = node as Record<string, unknown>;
    if (Object.hasOwn(obj, '__proto__')) {
      if (mode === 'error') throw new ProtoPoisoningError('__proto__');
      delete obj['__proto__'];
    }
    if (Object.hasOwn(obj, 'constructor')) {
      const ctor = obj['constructor'];
      if (typeof ctor === 'object' && ctor !== null && Object.hasOwn(ctor, 'prototype')) {
        if (mode === 'error') throw new ProtoPoisoningError('constructor.prototype');
        delete obj['constructor'];
      }
    }
    for (const key of Object.keys(obj)) stack.push(obj[key]);
  }
}

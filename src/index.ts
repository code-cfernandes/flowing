// Ponto de entrada público do PicoDecor.
// O polyfill precisa ser avaliado antes de qualquer decorator rodar.
import './shims/symbol-metadata.ts';

export * from './core/index.ts';
export * from './decorators/index.ts';

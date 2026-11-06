// Ponto de entrada público do Sashiko.
// O shim precisa ser avaliado antes de qualquer decorator rodar.
import './shims/symbol-metadata.ts';

export * from './core/index.ts';
export * from './decorators/index.ts';
export * from './middlewares/index.ts';

// Re-exporta TypeBox para que os usuários não precisem instalar como dependência separada
export { Type, type Static, type TSchema } from '@sinclair/typebox';

// TC39 não cria Symbol.metadata automaticamente em todo runtime.
// Este arquivo deve ser importado ANTES de qualquer decorator rodar.
if (!(Symbol as any).metadata) {
  (Symbol as any).metadata = Symbol.for('Symbol.metadata');
}
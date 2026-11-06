// TC39 não cria Symbol.metadata automaticamente em todo runtime.
// Este arquivo deve ser importado ANTES de qualquer decorator rodar.
const S = Symbol as { metadata?: symbol };
if (!S.metadata) {
  S.metadata = Symbol.for('Symbol.metadata');
}

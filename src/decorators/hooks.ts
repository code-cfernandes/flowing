import type { OnErrorHook, OnResponseHook } from '../core/app/options.ts';
import type { OnSendHook } from '../core/context.ts';
import type { ScopedHooks } from '../core/hooks.ts';
import { getOrCreateMethod, metadataFor } from '../core/metadata.ts';

type ClassOrMethodContext = ClassDecoratorContext | ClassMethodDecoratorContext;

/** Na classe (todas as rotas) ou no método; na ordem de leitura, como `@Middlewares` e `@Guards`. */
function register<K extends keyof ScopedHooks>(decorator: string, kind: K, hooks: ScopedHooks[K]) {
  return (_value: unknown, context: ClassOrMethodContext): void => {
    const meta = metadataFor(context, decorator);
    const target = context.kind === 'class' ? meta : getOrCreateMethod(meta, context.name);
    (target.hooks[kind] as unknown[]).unshift(...hooks);
  };
}

/**
 * `onSend` só para as rotas da classe ou do método (F-43): roda depois dos `onSend` do app, imediatamente
 * antes de escrever a resposta. A assinatura é a do `app.onSend`.
 *
 * ```ts
 * @OnSend((ctx) => void ctx.header('Cache-Control', 'private, max-age=60'))
 * @Get('/:id/invoice') invoice() {}
 * ```
 */
export function OnSend(...hooks: OnSendHook[]) {
  return register('OnSend', 'onSend', hooks);
}

/**
 * `onResponse` só para as rotas da classe ou do método (F-43): roda exatamente uma vez quando a requisição
 * termina (inclusive cancelada ou em stream), depois dos `onResponse` do app.
 */
export function OnResponse(...hooks: OnResponseHook[]) {
  return register('OnResponse', 'onResponse', hooks);
}

/**
 * `onError` só para as rotas da classe ou do método (F-43): roda antes dos `onError` do app, do escopo mais
 * específico para o mais externo. Se responder, os de fora (e a resposta padrão) não rodam.
 */
export function OnError(...hooks: OnErrorHook[]) {
  return register('OnError', 'onError', hooks);
}

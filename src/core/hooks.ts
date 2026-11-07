import type { OnErrorHook, OnResponseHook } from './app/options.ts';
import type { OnSendHook } from './context.ts';

/**
 * Hooks com escopo (F-43): os mesmos `onSend`, `onResponse` e `onError` do app, declarados num grupo, num
 * `mount()`, numa classe, num método ou numa rota manual. Só rodam quando uma rota daquele escopo atendeu.
 */
export interface HookOptions {
  onSend?: OnSendHook | readonly OnSendHook[];
  onResponse?: OnResponseHook | readonly OnResponseHook[];
  onError?: OnErrorHook | readonly OnErrorHook[];
}

/** Hooks acumulados de um escopo, de fora para dentro. */
export interface ScopedHooks {
  onSend: OnSendHook[];
  onResponse: OnResponseHook[];
  onError: OnErrorHook[];
}

/**
 * As listas prontas de uma rota, montadas no registro (nada por requisição). `onError` já vem do mais
 * específico para o mais externo, que é a ordem de execução.
 */
export interface RouteHooks {
  readonly onSend: readonly OnSendHook[];
  readonly onResponse: readonly OnResponseHook[];
  readonly onError: readonly OnErrorHook[];
}

export const emptyHooks = (): ScopedHooks => ({ onSend: [], onResponse: [], onError: [] });

const list = <T>(value: T | readonly T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? [...value] : [value as T]);

/** Normaliza as opções (`fn` ou `[fn, fn]`) em listas. */
export function hookOptions(opts: HookOptions | undefined): ScopedHooks {
  return { onSend: list(opts?.onSend), onResponse: list(opts?.onResponse), onError: list(opts?.onError) };
}

/** Junta escopos na ordem de fora para dentro. */
export function concatHooks(...scopes: readonly ScopedHooks[]): ScopedHooks {
  const out = emptyHooks();
  for (const s of scopes) {
    out.onSend.push(...s.onSend);
    out.onResponse.push(...s.onResponse);
    out.onError.push(...s.onError);
  }
  return out;
}

/** As listas finais da rota, ou `undefined` se ela não tem nenhum hook (o caso comum). */
export function routeHooks(scoped: ScopedHooks): RouteHooks | undefined {
  if (scoped.onSend.length + scoped.onResponse.length + scoped.onError.length === 0) return undefined;
  return Object.freeze({
    onSend: Object.freeze([...scoped.onSend]),
    onResponse: Object.freeze([...scoped.onResponse]),
    onError: Object.freeze([...scoped.onError].reverse()),
  });
}

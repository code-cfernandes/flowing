import type http from 'node:http';
import type { Middleware } from '../compose.ts';
import type { OnSendHook } from '../context.ts';
import type { Logger } from '../logger.ts';
import type { Serializer } from '../response/pipeline.ts';
import type { AppOptions, OnCloseHook, OnErrorHook, OnRequestHook, OnResponseHook } from './options.ts';

/**
 * Estado compartilhado do app entre a fachada (`SashikoApp`) e os componentes internos (registro,
 * servidor, pipeline da requisição). Só configuração e listas de hooks; nada por requisição.
 */
export interface AppCore {
  readonly opts: AppOptions;
  readonly log: Logger;
  readonly middlewares: Middleware[];
  readonly errorHandlers: OnErrorHook[];
  readonly onSendHooks: OnSendHook[];
  readonly onRequestHooks: OnRequestHook[];
  readonly onResponseHooks: OnResponseHook[];
  readonly onCloseHooks: OnCloseHook[];
  readonly serializers: ReadonlyMap<string, Serializer>;
  readonly allowedHosts: ((hostname: string, host: string) => boolean) | undefined;
  readonly applySecurityHeaders: ((res: http.ServerResponse) => void) | undefined;
}

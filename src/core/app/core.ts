import type { UploadSettings } from '../uploads/receive.ts';
import type http from 'node:http';
import type { Middleware } from '../compose.ts';
import type { OnSendHook } from '../context.ts';
import type { Logger } from '../logger.ts';
import type { Telemetry } from '../telemetry.ts';
import type { Serializer } from '../response/pipeline.ts';
import type { AppOptions, OnCloseHook, OnErrorHook, OnRequestHook, OnResponseHook } from './options.ts';
import type { Contracts } from '../contracts.ts';

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
  /** O motor dos contratos (F-27): o do app, ou o nativo. */
  readonly contracts: Contracts;
  /** OpenTelemetry, quando `createApp({ telemetry })` (F-38). */
  readonly telemetry: Telemetry | undefined;
  readonly onResponseHooks: OnResponseHook[];
  /** Rotas com `onResponse` de escopo (F-43): basta uma para o observer acompanhar o fim das requisições. */
  scopedOnResponse: number;
  readonly onCloseHooks: OnCloseHook[];
  readonly serializers: ReadonlyMap<string, Serializer>;
  /** Configuração de upload (F-46), resolvida na criação do app. */
  readonly uploads: UploadSettings;
  readonly allowedHosts: ((hostname: string, host: string) => boolean) | undefined;
  readonly applySecurityHeaders: ((res: http.ServerResponse) => void) | undefined;
}

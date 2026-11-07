import type { Context } from '../context.ts';
import type { ErrorFormatter } from '../errors.ts';
import type { Logger } from '../logger.ts';
import type { Serializer } from '../response/pipeline.ts';
import type { ShutdownOptions } from '../shutdown.ts';
import type { TlsOptions } from '../../server/tls.ts';
import type { ProtoPoisoning } from '../../utils/safe-json.ts';
import type { SecurityHeadersOptions, SecurityPreset } from '../../middlewares/security-headers.ts';

/** Depois do envio da resposta (F-04). */
export type OnResponseHook = (ctx: Context, info: { status: number; ms: number }) => void | Promise<void>;
/** No `close()` do app (F-04). */
export type OnCloseHook = () => void | Promise<void>;

export interface ListenOptions {
  /** Padrão: 3000. Use 0 para uma porta livre aleatória. */
  port?: number;
  /** Padrão: `127.0.0.1`. Use `0.0.0.0` para aceitar conexões externas (ex.: em containers). */
  host?: string;
  /**
   * Sobe em HTTPS, com os mesmos timeouts, encerramento gracioso e `close()` do HTTP. Atrás de um
   * proxy que termina o TLS (Caddy, Nginx, load balancer), não use: fique em HTTP com `trustProxy`.
   */
  tls?: TlsOptions;
}

export interface ServerTimeouts {
  /** Tempo máximo para receber a requisição inteira. Padrão: 30s. */
  requestTimeout?: number;
  /** Tempo máximo para receber os headers (mitiga Slowloris). Padrão: 10s. */
  headersTimeout?: number;
  /** Tempo de conexão keep-alive ociosa. Padrão: 5s. */
  keepAliveTimeout?: number;
}

export interface AppOptions {
  /** Tamanho máximo do body JSON em bytes. Padrão: 1 MiB. */
  bodyLimit?: number;
  /**
   * Headers de segurança aplicados a toda resposta (S-04). Padrão: `'api'`.
   * `'web'` libera recursos do próprio site (CSP `'self'`) para quem serve páginas; `false` desliga.
   */
  securityHeaders?: SecurityHeadersOptions | SecurityPreset | false;
  /**
   * Serializadores por content type, para responder em outros formatos (F-31):
   * `{ 'application/yaml': (data) => YAML.stringify(data) }`. JSON e valores crus já são nativos.
   */
  serializers?: Record<string, Serializer>;
  /** Timeouts do servidor HTTP (S-06). */
  timeouts?: ServerTimeouts;
  /**
   * Modo estrito (S-07): exige schema de `body` em POST/PUT/PATCH e schema de `response`
   * em toda rota, falhando no `app.mount()`. Padrão: `false`.
   */
  requireSchemas?: boolean;
  /**
   * Body JSON com `__proto__` ou `constructor.prototype` (S-08): `'error'` responde 400
   * (`PROTO_POISONING`); `'remove'` descarta as chaves e segue. Padrão: `'error'`.
   */
  protoPoisoning?: ProtoPoisoning;
  /** Máximo de pares chave/valor lidos da query string. Padrão: 1000 (S-06). */
  queryMaxKeys?: number;
  /** Logger compatível com pino. Padrão: `consoleLogger()`; `false` desliga (F-06). */
  logger?: Logger | false;
  /** Loga cada requisição concluída (método, path, status, duração) em nível `info`. Padrão: `false`. */
  logRequests?: boolean;
  /** Request id (F-06). */
  requestId?: RequestIdOptions;
  /**
   * Encerramento gracioso nos sinais do processo, ativado pelo `listen()` (F-07).
   * Ligado por padrão (SIGINT/SIGTERM, 10s); `false` desliga.
   */
  shutdown?: ShutdownOptions | false;
  /**
   * Confia nos headers `X-Forwarded-For`, `-Host` e `-Proto` para `ctx.ip`, `ctx.host` e `ctx.protocol`
   * (S-09). Padrão: `false`. Use `true` para confiar em toda a cadeia, ou o número de proxies à frente
   * do app (ex.: `1` para um load balancer). Só ligue atrás de um proxy que reescreve esses headers.
   */
  trustProxy?: boolean | number;
  /**
   * Hosts aceitos (S-09). Requisições com outro `Host` (ou `X-Forwarded-Host` confiável) recebem 400.
   * Protege contra host header injection e DNS rebinding. Padrão: qualquer host válido.
   * - `'api.exemplo.com'` casa com o hostname (qualquer porta); `'api.exemplo.com:8443'` exige a porta;
   * - `'*.exemplo.dev'` aceita só subdomínios;
   * - uma RegExp precisa casar o hostname **inteiro** (como se tivesse `^…$`).
   */
  allowedHosts?: readonly (string | RegExp)[];
  /**
   * Rotas com `host` (virtual hosts) fora do `allowedHosts` nunca são alcançadas (F-35). `'error'` (padrão)
   * falha no registro; `'warn'` só registra um aviso no log; `'off'` não confere.
   */
  unreachableHosts?: 'error' | 'warn' | 'off';
  /**
   * Personaliza o corpo de todos os erros do framework e dos `HttpError` (F-15). Padrão: Problem
   * Details (RFC 9457) em `application/problem+json`. O retorno é enviado como `application/json`.
   */
  formatError?: ErrorFormatter;
}

export interface RequestIdOptions {
  /** Header lido da requisição e devolvido na resposta. Padrão: `x-request-id`. `false` não envia. */
  header?: string | false;
  /**
   * Reaproveita o id recebido no header (útil atrás de um gateway). Padrão: `true`.
   * O valor só é aceito se tiver até 128 caracteres de `[A-Za-z0-9._:-]`, para evitar log injection.
   */
  trustIncoming?: boolean;
  /** Gerador de ids. Padrão: `crypto.randomUUID()`. */
  generate?: () => string;
}

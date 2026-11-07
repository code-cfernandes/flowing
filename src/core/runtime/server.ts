import http from 'node:http';
import https from 'node:https';
import type { AppCore } from '../app/core.ts';
import type { ListenOptions } from '../app/options.ts';
import type { Context } from '../context.ts';
import type { Logger } from '../logger.ts';
import { shutdownCoordinator, type ShutdownTarget } from '../shutdown.ts';
import { kAbort } from '../symbols.ts';
import { compileTls, type SniTable, type TlsOptions } from '../../server/tls.ts';

/** Servidor HTTP/HTTPS do app: `listen`, `close`, troca de certificados, drain e shutdown por sinal (F-07, F-33). */
export class ServerLifecycle {
  server: http.Server | https.Server | undefined;
  private tlsState: { sni: { current: SniTable } } | undefined;
  /**
   * Respostas de streaming abertas (SSE, NDJSON, `Readable`), que o `close()` cancela para não esperar por
   * elas. Só streams entram aqui: um conjunto com todas as respostas em andamento fazia cada uma sobreviver
   * às coletas rápidas do V8 e ser promovida, junto com `req` e o parser, e dobrava o RSS de pico (F-41).
   */
  readonly streams = new Set<Context>();
  closing: http.Server | https.Server | undefined;
  draining = false;
  private closeHooksPending = true;

  /**
   * Respostas dos servidores criados pelo `listen()`. Durante o `close()`, as que ainda não enviaram headers
   * saem com `Connection: close`, para o cliente não reaproveitar a conexão. Assim o app não precisa guardar
   * as respostas em andamento só para isso (F-41).
   */
  private readonly responseClass = (() => {
    const lifecycle = this;
    class SashikoResponse extends http.ServerResponse {}
    // Atribuição no protótipo: o `writeHead` do Node tem várias sobrecargas, e só repassamos os argumentos.
    const base = http.ServerResponse.prototype.writeHead as (this: http.ServerResponse, ...args: unknown[]) => http.ServerResponse;
    (SashikoResponse.prototype as unknown as { writeHead: typeof base }).writeHead = function (...args) {
      if (lifecycle.closing) this.shouldKeepAlive = false;
      return base.apply(this, args);
    };
    return SashikoResponse;
  })();

  constructor(
    private readonly core: AppCore,
    /** Listener `(req, res)` do app, criado a cada `listen()`. */
    private readonly listener: () => http.RequestListener,
  ) {
    const sd = core.opts.shutdown || {};
    Object.assign(this.shutdownTarget, {
      log: core.log,
      signals: sd.signals ?? ['SIGINT', 'SIGTERM'],
      exitOnShutdown: sd.exit ?? true,
    });
  }

  async listen(options: ListenOptions & { tls: TlsOptions }): Promise<https.Server>;
  async listen(options?: number | ListenOptions): Promise<http.Server>;
  async listen(options: number | ListenOptions = {}): Promise<http.Server | https.Server> {
    if (this.server) throw new Error('[sashiko] app is already listening; call app.close() first.');
    const { port = 3000, host = '127.0.0.1', tls } = typeof options === 'number' ? { port: options } : options;

    let server: http.Server | https.Server;
    if (tls) {
      const sni = { current: { find: () => undefined } as SniTable };
      const compiled = compileTls(tls, sni);
      server = https.createServer({ ...compiled.options, ServerResponse: this.responseClass }, this.listener());
      this.tlsState = { sni };
    } else {
      server = http.createServer({ ServerResponse: this.responseClass }, this.listener());
      this.tlsState = undefined;
    }
    const t = this.core.opts.timeouts ?? {};
    server.requestTimeout = t.requestTimeout ?? 30_000;
    server.headersTimeout = Math.min(t.headersTimeout ?? 10_000, server.requestTimeout || Infinity);
    server.keepAliveTimeout = t.keepAliveTimeout ?? 5_000;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    this.closeHooksPending = true;
    this.draining = false;
    if (this.core.opts.shutdown !== false) shutdownCoordinator.register(this.shutdownTarget);
    return server;
  }

  /**
   * Troca os certificados sem reiniciar nem derrubar conexões (renovação, ACME externo). Conexões novas
   * usam os novos; as abertas seguem com os antigos. Um certificado inválido lança erro e mantém os atuais.
   */
  reloadTLS(tls: TlsOptions): void {
    const server = this.server;
    if (!server || !this.tlsState || !(server instanceof https.Server)) {
      throw new Error('[sashiko] reloadTLS(): the app is not listening with { tls }.');
    }
    const next = { current: this.tlsState.sni.current };
    const compiled = compileTls(tls, next); // valida tudo antes de trocar
    if (compiled.main) server.setSecureContext(compiled.main);
    this.tlsState.sni.current = next.current;
  }

  /** Ponte entre este app e o coordenador de sinais (F-07). */
  readonly shutdownTarget: ShutdownTarget = {
    log: undefined as unknown as Logger, // definido no construtor
    signals: [],
    exitOnShutdown: true,
    shutdown: async (signal) => {
      const opts = this.core.opts.shutdown || {};
      try {
        this.draining = true;
        if (opts.drainDelayMs) {
          this.core.log.info({ signal, drainDelayMs: opts.drainDelayMs }, 'draining before shutdown');
          await new Promise((r) => setTimeout(r, opts.drainDelayMs));
        }
        await this.close(opts.timeoutMs ?? 10_000);
        await opts.onShutdown?.(signal);
        return true;
      } catch (err) {
        this.core.log.error({ err, signal }, 'error during graceful shutdown');
        return false;
      }
    },
  };

  /**
   * Para de aceitar conexões, encerra as ociosas e espera as requisições em andamento terminarem.
   * Depois de `graceMs`, força o fechamento das restantes.
   */
  async close(graceMs = 10_000): Promise<void> {
    const server = this.server;
    if (!server) return this.runCloseHooks();
    this.server = undefined;
    this.closing = server;
    // Streams longos (SSE, NDJSON) não terminam sozinhos: o `ctx.signal` é cancelado para eles fecharem
    // já, em vez de segurar o encerramento até o prazo. Requisições comuns seguem até terminar, e cada
    // conexão é fechada assim que fica ociosa (listener `close` das respostas, no request-handler).
    for (const ctx of this.streams) ctx[kAbort]('SHUTDOWN');
    const force = setTimeout(() => server.closeAllConnections(), graceMs);
    force.unref();
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeIdleConnections();
      });
    } finally {
      clearTimeout(force);
      this.closing = undefined;
      shutdownCoordinator.unregister(this.shutdownTarget);
    }
    await this.runCloseHooks();
  }

  /** `onClose` uma vez por ciclo (até o próximo `listen`); todos rodam mesmo se algum falhar (F-04). */
  async runCloseHooks(): Promise<void> {
    if (!this.closeHooksPending) return;
    this.closeHooksPending = false;
    const errors: unknown[] = [];
    for (const hook of this.core.onCloseHooks) {
      try {
        await hook();
      } catch (err) {
        errors.push(err);
        this.core.log.error({ err }, 'onClose hook failed');
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, `[sashiko] ${errors.length} onClose hook(s) failed`);
  }
}

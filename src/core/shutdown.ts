import type { Logger } from './logger.ts';

export interface ShutdownOptions {
  /** Sinais tratados. Padrão: `['SIGINT', 'SIGTERM']`. */
  signals?: readonly NodeJS.Signals[];
  /**
   * Espera antes de parar de aceitar conexões, com o `/readyz` já em 503, para o load balancer tirar
   * a instância de rotação (Kubernetes, ECS…). Padrão: 0.
   */
  drainDelayMs?: number;
  /** Prazo para as requisições em andamento terminarem. Padrão: 10s. */
  timeoutMs?: number;
  /** Executado depois que o servidor fecha (banco, filas…). Se lançar, o processo sai com código 1. */
  onShutdown?: (signal: NodeJS.Signals) => void | Promise<void>;
  /** Chama `process.exit` ao final. Padrão: `true`. Use `false` se outro código controla o processo. */
  exit?: boolean;
}

/** O que o coordenador precisa de cada app que está ouvindo. */
export interface ShutdownTarget {
  readonly log: Logger;
  /** Fecha o app e roda o `onShutdown`; resolve com `false` se algo falhou. */
  shutdown(signal: NodeJS.Signals): Promise<boolean>;
  /** Se este app quer `process.exit` ao final. */
  readonly exitOnShutdown: boolean;
  readonly signals: readonly NodeJS.Signals[];
}

/**
 * Coordena o encerramento de todos os apps ouvindo no processo (F-07):
 * um único listener por sinal, compartilhado, removido quando o último app fecha.
 */
class ShutdownCoordinator {
  private readonly targets = new Set<ShutdownTarget>();
  private readonly listeners = new Map<NodeJS.Signals, () => void>();
  private shuttingDown = false;

  register(target: ShutdownTarget): void {
    this.targets.add(target);
    for (const signal of target.signals) {
      if (this.listeners.has(signal)) continue;
      const listener = () => void this.onSignal(signal);
      this.listeners.set(signal, listener);
      process.on(signal, listener);
    }
  }

  unregister(target: ShutdownTarget): void {
    this.targets.delete(target);
    // Durante um encerramento, os listeners ficam até o fim: o segundo sinal precisa ser ouvido
    // enquanto o onShutdown ainda roda (ex.: fechando o banco).
    if (!this.shuttingDown) this.prune();
  }

  private prune(): void {
    const stillUsed = new Set([...this.targets].flatMap((t) => t.signals));
    for (const [signal, listener] of this.listeners) {
      if (stillUsed.has(signal)) continue;
      process.off(signal, listener);
      this.listeners.delete(signal);
    }
  }

  private async onSignal(signal: NodeJS.Signals): Promise<void> {
    const targets = [...this.targets].filter((t) => t.signals.includes(signal));
    if (this.shuttingDown) {
      // Segundo sinal durante o encerramento: o usuário quer sair já (Ctrl+C duplo).
      targets[0]?.log.warn({ signal }, 'second signal received, forcing exit');
      process.exit(1);
    }
    this.shuttingDown = true;
    targets[0]?.log.info({ signal }, 'shutting down gracefully');

    const results = await Promise.all(targets.map((t) => t.shutdown(signal)));
    const ok = results.every(Boolean);
    this.shuttingDown = false;
    this.prune();
    if (targets.some((t) => t.exitOnShutdown)) process.exit(ok ? 0 : 1);
  }
}

export const shutdownCoordinator = new ShutdownCoordinator();

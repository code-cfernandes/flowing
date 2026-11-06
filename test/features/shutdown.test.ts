import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { describe, it, mock } from 'node:test';
import { createApp, Get, Router } from 'sashiko';

// O handler avisa quando começou, para o teste enviar o sinal com a requisição de fato em andamento.
let markStarted: () => void = () => {};
@Router('/s')
class Slow {
  @Get('/') async slow() { markStarted(); await new Promise((r) => setTimeout(r, 120)); return { done: true }; }
}

const count = (signal: NodeJS.Signals) => process.listenerCount(signal);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('F-07 · graceful shutdown', () => {
  it('listen() registra SIGINT/SIGTERM e close() remove', async () => {
    const before = [count('SIGINT'), count('SIGTERM')];
    const app = createApp({ logger: false, shutdown: { exit: false } });
    await app.listen(0);
    assert.deepEqual([count('SIGINT'), count('SIGTERM')], [before[0]! + 1, before[1]! + 1]);
    await app.close();
    assert.deepEqual([count('SIGINT'), count('SIGTERM')], before);
  });

  it('vários apps compartilham um único listener por sinal', async () => {
    const before = count('SIGTERM');
    const a = createApp({ logger: false, shutdown: { exit: false } });
    const b = createApp({ logger: false, shutdown: { exit: false } });
    await a.listen(0);
    await b.listen(0);
    assert.equal(count('SIGTERM'), before + 1);
    await a.close();
    assert.equal(count('SIGTERM'), before + 1, 'b ainda está ouvindo');
    await b.close();
    assert.equal(count('SIGTERM'), before);
  });

  it('shutdown: false, inject() e callback() não registram listeners', async () => {
    const before = count('SIGTERM');
    const app = createApp({ logger: false, shutdown: false });
    await app.listen(0);
    await createApp({ logger: false }).inject('/x');
    createApp({ logger: false }).callback();
    assert.equal(count('SIGTERM'), before);
    await app.close();
  });

  it('no sinal: espera a requisição em andamento, fecha e chama onShutdown', async () => {
    const calls: string[] = [];
    const app = createApp({
      logger: false,
      shutdown: { exit: false, onShutdown: (signal) => { calls.push(`onShutdown:${signal}`); } },
    }).mount(Slow);
    const server = await app.listen(0);
    const { port } = server.address() as AddressInfo;

    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const pending = fetch(`http://127.0.0.1:${port}/s`).then(async (r) => { calls.push('response'); return r.json(); });
    await started;
    process.emit('SIGTERM');
    assert.deepEqual(await pending, { done: true }, 'requisição em andamento termina');
    // Espera o encerramento terminar (servidor fechado e onShutdown chamado), sem depender de um tempo fixo.
    for (let i = 0; i < 100 && (server.listening || calls.length < 2); i++) await tick(10);
    // O servidor termina a resposta, fecha e só então chama o onShutdown; o cliente pode terminar de ler depois.
    assert.deepEqual([...calls].sort(), ['onShutdown:SIGTERM', 'response']);
    assert.equal(server.listening, false);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/s`), 'não aceita novas conexões');
  });

  it('sinais configuráveis', async () => {
    const before = [count('SIGINT'), count('SIGUSR2')];
    const app = createApp({ logger: false, shutdown: { exit: false, signals: ['SIGUSR2'] } });
    await app.listen(0);
    assert.deepEqual([count('SIGINT'), count('SIGUSR2')], [before[0], before[1]! + 1]);
    await app.close();
  });

  it('sai com 0 por padrão e com 1 se o onShutdown falhar', async () => {
    const exit = mock.method(process, 'exit', (() => undefined) as never);
    try {
      const ok = createApp({ logger: false });
      await ok.listen(0);
      process.emit('SIGTERM');
      await tick(50);
      assert.deepEqual(exit.mock.calls.at(-1)?.arguments, [0]);

      const bad = createApp({ logger: false, shutdown: { onShutdown: () => { throw new Error('db'); } } });
      await bad.listen(0);
      process.emit('SIGTERM');
      await tick(50);
      assert.deepEqual(exit.mock.calls.at(-1)?.arguments, [1]);
    } finally {
      exit.mock.restore();
    }
  });

  it('segundo sinal durante o encerramento força a saída com 1', async () => {
    const exit = mock.method(process, 'exit', (() => undefined) as never);
    try {
      const app = createApp({ logger: false, shutdown: { onShutdown: async () => { await tick(100); } } });
      await app.listen(0);
      process.emit('SIGINT');
      await tick(10);
      process.emit('SIGINT');
      assert.deepEqual(exit.mock.calls[0]?.arguments, [1]);
      await tick(150);
    } finally {
      exit.mock.restore();
    }
  });
});

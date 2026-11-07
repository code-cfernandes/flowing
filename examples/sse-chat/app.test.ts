import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import { buildApp } from './app.ts';
import { ChatHub } from './hub.ts';

/** Abre uma conexão SSE e junta os eventos `message` recebidos. */
function subscribe(port: number, lastEventId?: string) {
  const events: { id: string; data: { author: string; text: string } }[] = [];
  let buffer = '';
  let req!: http.ClientRequest;
  const opened = new Promise<void>((resolve) => {
    req = http.get({ port, path: '/chat/events', headers: lastEventId ? { 'last-event-id': lastEventId } : {} }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let end = buffer.indexOf('\n\n');
        while (end !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const id = /^id: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (id && data) events.push({ id, data: JSON.parse(data) });
          end = buffer.indexOf('\n\n');
        }
      });
      resolve();
    });
  });
  return { events, opened, close: () => req.destroy() };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(check(), 'condição não atingida a tempo');
};

describe('exemplo sse-chat', async () => {
  const hub = new ChatHub();
  const app = buildApp(hub);
  const server = await app.listen(0);
  const port = (server.address() as AddressInfo).port;
  after(() => app.close(1_000));
  const send = (author: string, text: string) =>
    fetch(`http://127.0.0.1:${port}/chat/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ author, text }),
    });

  it('uma mensagem chega a todas as conexões abertas', async () => {
    const a = subscribe(port);
    const b = subscribe(port);
    await Promise.all([a.opened, b.opened]);
    await until(() => hub.connections === 2);
    assert.equal((await send('ana', 'oi')).status, 201);
    await until(() => a.events.length === 1 && b.events.length === 1);
    assert.deepEqual(a.events[0]!.data, b.events[0]!.data);
    assert.equal(a.events[0]!.data.text, 'oi');
    a.close();
    b.close();
    await until(() => hub.connections === 0); // quem sai deixa de receber (onClose)
  });

  it('quem reconecta com Last-Event-ID recebe só o que perdeu', async () => {
    await send('bia', 'segunda');
    await send('bia', 'terceira');
    const late = subscribe(port, '1');
    await late.opened;
    await until(() => late.events.length === 2);
    assert.deepEqual(
      late.events.map((e) => e.data.text),
      ['segunda', 'terceira'],
    );
    late.close();
  });

  it('valida a mensagem', async () => {
    assert.equal((await send('', 'x')).status, 400);
  });
});

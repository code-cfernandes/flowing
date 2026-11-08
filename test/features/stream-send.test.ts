import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, describe, it } from 'node:test';
import { type Context, createApp, Get, Router } from 'sashiko';
import { startServer } from '../helpers/server.ts';

const dir = mkdtempSync(join(tmpdir(), 'sashiko-stream-'));
const big = join(dir, 'grande.bin');
writeFileSync(big, Buffer.alloc(8 * 1024 * 1024, 7));
after(() => rmSync(dir, { recursive: true, force: true }));

/** Logger que guarda as mensagens, para conferir o que o envio registra. */
const capture = () => {
  const lines: { level: string; msg: string }[] = [];
  const log = (level: string) => (_obj: unknown, msg?: string) => void lines.push({ level, msg: msg ?? '' });
  const logger = { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error'), child: () => logger };
  return { lines, logger };
};

let sources: Readable[] = [];
@Router('/')
class Streams {
  @Get('/quebra') quebra(ctx: Context) {
    const src = new Readable({
      read() {
        this.push('começo;');
        setImmediate(() => this.destroy(new Error('disco falhou')));
      },
    });
    ctx.send(src, 'text/plain');
  }
  @Get('/infinito') infinito(ctx: Context) {
    let n = 0;
    const src = new Readable({
      read() {
        setTimeout(() => this.push(`linha ${n++}\n`), 5);
      },
    });
    sources.push(src);
    // O close() avisa pelo ctx.signal; o stream decide como encerrar.
    ctx.signal.addEventListener('abort', () => src.push(null));
    ctx.send(src, 'text/plain');
  }
}

const app = (logger?: unknown) => {
  const a = createApp({ shutdown: false, ...(logger ? { logger: logger as never } : { logger: false }) });
  a.mount(Streams);
  a.static('/s', dir);
  return a;
};

describe('F-45 · envio de streams sem pipeline()', () => {
  it('erro na origem: loga "stream failed" e corta a resposta', async () => {
    const { lines, logger } = capture();
    const s = await startServer(app(logger));
    try {
      await assert.rejects(async () => (await fetch(`${s.url}/quebra`)).text());
      assert.ok(lines.some((l) => l.level === 'error' && l.msg === 'stream failed'));
    } finally {
      await s.close();
    }
  });

  it('cliente desiste no meio: a origem é destruída (sem descritor preso) e o log é debug', async () => {
    sources = [];
    const { lines, logger } = capture();
    const s = await startServer(app(logger));
    try {
      await new Promise<void>((resolve) => {
        const req = request(`${s.url}/infinito`, (res) => {
          res.once('data', () => {
            req.destroy();
            resolve();
          });
        });
        req.on('error', () => {});
        req.end();
      });
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(sources[0]?.destroyed, true, 'a origem foi destruída');
      assert.ok(lines.some((l) => l.level === 'debug' && l.msg === 'client disconnected during stream'));
      assert.ok(!lines.some((l) => l.level === 'error'), 'desconexão do cliente não é erro');
    } finally {
      await s.close();
    }
  });

  it('download de arquivo em andamento termina inteiro durante o close()', async () => {
    const a = app();
    const s = await startServer(a);
    const res = await fetch(`${s.url}/s/grande.bin`);
    const closing = a.close();
    const body = Buffer.from(await res.arrayBuffer());
    await closing;
    assert.equal(body.length, 8 * 1024 * 1024, 'o arquivo chegou inteiro');
  });

  it('stream próprio continua recebendo o aviso do close() pelo ctx.signal', async () => {
    sources = [];
    const a = app();
    const s = await startServer(a);
    const res = await fetch(`${s.url}/infinito`);
    const reader = res.body!.getReader();
    await reader.read();
    const started = Date.now();
    await a.close();
    assert.ok(Date.now() - started < 5000, 'o close() não esperou o stream infinito');
  });
});

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { type Context, contracts, createApp, Post, Router, type RouteSchemas, Type } from 'sashiko';
import { z } from 'zod';
import { startServer, type TestServer } from '../helpers/server.ts';

const PDF = '%PDF-1.4\n%conteúdo de teste\n';
const EXE = Buffer.from('4d5a90000300000004000000ffff0000', 'hex');

const enviar = {
  body: Type.Object({ membro: Type.String({ minLength: 2 }), ano: Type.Integer() }),
  files: { pdf: { required: true, maxSize: '1kb', types: ['application/pdf'] } },
  response: {
    201: Type.Object({ nome: Type.String(), tamanho: Type.Number(), tipo: Type.String(), conteudo: Type.String(), ano: Type.Number() }),
  },
} satisfies RouteSchemas;
const fotos = {
  files: { fotos: { maxCount: 2, types: ['image/*'] }, nota: { types: ['text/plain'] } },
  response: { 200: Type.Object({ fotos: Type.Number(), nota: Type.Boolean() }) },
} satisfies RouteSchemas;
const lento = { files: { arq: {} }, response: { 200: Type.Object({ ok: Type.Boolean() }) } } satisfies RouteSchemas;
const proprio = {
  files: { doc: { types: ['application/x-sashiko'], verify: (head: Uint8Array) => head[0] === 0x53 } },
  response: { 200: Type.Object({ ok: Type.Boolean() }) },
} satisfies RouteSchemas;

@Router('/up')
class Uploads {
  @Post('/documentos', enviar) async enviar(ctx: Context<typeof enviar>) {
    const pdf = ctx.file('pdf'); // obrigatório: nunca undefined
    const ano: number = ctx.body.ano; // convertido do texto do formulário
    const conteudo = (await pdf.buffer()).toString();
    return { nome: pdf.filename, tamanho: pdf.size, tipo: pdf.detectedType ?? '', conteudo, ano };
  }
  @Post('/fotos', fotos) fotos(ctx: Context<typeof fotos>) {
    return { fotos: ctx.files('fotos').length, nota: ctx.file('nota') !== undefined };
  }
  @Post('/lento', lento) lento() {
    return { ok: true };
  }
  @Post('/proprio', proprio) proprio() {
    return { ok: true };
  }
  @Post('/sem-files') semFiles(ctx: Context) {
    return { intacto: ctx.req.readableEnded === false };
  }
}

const temps = (dir: string) => readdirSync(dir).filter((n) => n.startsWith('sashiko-upload-')).length;
const form = (entries: [string, string | File][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};
const pdf = (content: string | Buffer = PDF, name = 'relatorio.pdf', type = 'application/pdf') =>
  new File([typeof content === 'string' ? content : new Uint8Array(content)], name, { type });

describe('F-46 · upload nativo (multipart/form-data)', () => {
  let server: TestServer;
  let dir: string;
  const post = async (path: string, body: FormData | string, headers: Record<string, string> = {}) => {
    const r = await fetch(`${server.url}/up${path}`, { method: 'POST', body, headers });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  /** Espera o `close` das respostas apagar os temporários. */
  const settle = () => new Promise((r) => setTimeout(r, 50));

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sashiko-up-test-'));
    const app = createApp({ logger: false, shutdown: false, uploads: { tempDir: dir, limits: { fileSize: '64kb' } } });
    app.mount(Uploads);
    server = await startServer(app);
  });
  after(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('recebe o arquivo e os campos: tipado, conteúdo detectado, campos convertidos e validados', async () => {
    const r = await post(
      '/documentos',
      form([
        ['membro', 'Ana'],
        ['ano', '2026'],
        ['pdf', pdf()],
      ]),
    );
    assert.equal(r.status, 201);
    assert.deepEqual(r.body, { nome: 'relatorio.pdf', tamanho: Buffer.byteLength(PDF), tipo: 'application/pdf', conteudo: PDF, ano: 2026 });
  });

  it('campos inválidos do formulário: 400 VALIDATION_ERROR pelo contrato body', async () => {
    const r = await post(
      '/documentos',
      form([
        ['membro', 'A'],
        ['ano', 'dois mil'],
        ['pdf', pdf()],
      ]),
    );
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'VALIDATION_ERROR');
  });

  it('arquivo maior que o maxSize: 413 FILE_TOO_LARGE, e o handler não roda', async () => {
    const r = await post(
      '/documentos',
      form([
        ['membro', 'Ana'],
        ['ano', '1'],
        ['pdf', pdf(`%PDF-${'a'.repeat(2048)}`)],
      ]),
    );
    assert.equal(r.status, 413);
    assert.equal(r.body.code, 'FILE_TOO_LARGE');
  });

  it('tipo declarado errado e tipo falso (executável com nome e tipo de PDF): 400 INVALID_FILE_TYPE', async () => {
    const errado = await post(
      '/documentos',
      form([
        ['membro', 'Ana'],
        ['ano', '1'],
        ['pdf', pdf(PDF, 'a.png', 'image/png')],
      ]),
    );
    assert.equal(errado.status, 400);
    assert.equal(errado.body.code, 'INVALID_FILE_TYPE');
    const falso = await post(
      '/documentos',
      form([
        ['membro', 'Ana'],
        ['ano', '1'],
        ['pdf', pdf(EXE)],
      ]),
    );
    assert.equal(falso.status, 400);
    assert.equal(falso.body.code, 'INVALID_FILE_TYPE');
  });

  it('obrigatório ausente: 400 FILE_REQUIRED; campo de arquivo não declarado: 400 UNEXPECTED_FILE', async () => {
    const falta = await post(
      '/documentos',
      form([
        ['membro', 'Ana'],
        ['ano', '1'],
      ]),
    );
    assert.equal(falta.body.code, 'FILE_REQUIRED');
    const extra = await post(
      '/documentos',
      form([
        ['membro', 'Ana'],
        ['ano', '1'],
        ['pdf', pdf()],
        ['outro', pdf()],
      ]),
    );
    assert.equal(extra.status, 400);
    assert.equal(extra.body.code, 'UNEXPECTED_FILE');
  });

  it('vários arquivos no mesmo campo, até o maxCount; texto confere só o tipo declarado', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const foto = () => new File([new Uint8Array(png)], 'f.png', { type: 'image/png' });
    const nota = new File(['qualquer texto'], 'n.txt', { type: 'text/plain' });
    const ok = await post(
      '/fotos',
      form([
        ['fotos', foto()],
        ['fotos', foto()],
        ['nota', nota],
      ]),
    );
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { fotos: 2, nota: true });
    const demais = await post(
      '/fotos',
      form([
        ['fotos', foto()],
        ['fotos', foto()],
        ['fotos', foto()],
      ]),
    );
    assert.equal(demais.status, 400);
    assert.equal(demais.body.code, 'TOO_MANY_FILES');
  });

  it('verify: regra própria do conteúdo para formatos sem assinatura conhecida', async () => {
    const doc = (c: string) => form([['doc', new File([c], 'x.sk', { type: 'application/x-sashiko' })]]);
    assert.equal((await post('/proprio', doc('SASHIKO'))).status, 200);
    assert.equal((await post('/proprio', doc('outra coisa'))).body.code, 'INVALID_FILE_TYPE');
  });

  it('nome de arquivo malicioso é só metadado: o temporário tem nome gerado', async () => {
    const r = await post(
      '/documentos',
      form([
        ['membro', 'Ana'],
        ['ano', '1'],
        ['pdf', pdf(PDF, '../../etc/passwd.pdf')],
      ]),
    );
    assert.equal(r.status, 201);
    assert.ok(!String(r.body.nome).includes('/'), 'sem caminho no nome');
  });

  it('rota com files recebendo JSON: 415; rota sem files recebendo multipart: corpo intacto em ctx.req', async () => {
    const json = await post('/documentos', '{}', { 'content-type': 'application/json' });
    assert.equal(json.status, 415);
    const intacto = await post('/sem-files', form([['pdf', pdf()]]));
    assert.deepEqual(intacto.body, { intacto: true });
  });

  it('nenhum temporário sobra, em sucesso e em erro', async () => {
    await settle();
    assert.equal(temps(dir), 0);
  });

  it('cancelamento no meio do envio: sem temporário órfão, servidor segue respondendo', async () => {
    const boundary = 'sashikoBoundary';
    await new Promise<void>((resolve) => {
      const req = request(`${server.url}/up/lento`, {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': '100000' },
      });
      req.on('error', () => resolve());
      req.write(
        `--${boundary}\r\nContent-Disposition: form-data; name="arq"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      );
      req.write(Buffer.alloc(8192, 1));
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 30);
    });
    await settle();
    assert.equal(temps(dir), 0, 'o temporário do envio cancelado foi apagado');
    const r = await post(
      '/documentos',
      form([
        ['membro', 'Ana'],
        ['ano', '1'],
        ['pdf', pdf()],
      ]),
    );
    assert.equal(r.status, 201);
  });

  it('uma rota não pode ampliar o limite global: erro no registro', () => {
    @Router('/x')
    class Grande {
      @Post('/', { files: { f: { maxSize: '1gb' } } }) up() {}
    }
    const app = createApp({ logger: false, shutdown: false });
    assert.throws(() => app.mount(Grande), /larger than uploads\.limits\.fileSize/);
  });

  it('contracts.standard(): os campos do formulário validados pelo Zod (z.coerce)', async () => {
    const zod = { body: z.object({ ano: z.coerce.number() }), files: { pdf: { required: true } } } satisfies RouteSchemas;
    @Router('/z')
    class Zod {
      @Post('/', zod) up(ctx: Context<typeof zod>) {
        return { ano: ctx.body.ano + 1, nome: ctx.file('pdf').filename };
      }
    }
    const app = createApp({ logger: false, shutdown: false, contracts: contracts.standard(), uploads: { tempDir: dir } });
    app.mount(Zod);
    const s = await startServer(app);
    try {
      const r = await fetch(`${s.url}/z`, {
        method: 'POST',
        body: form([
          ['ano', '2025'],
          ['pdf', pdf()],
        ]),
      });
      assert.deepEqual(await r.json(), { ano: 2026, nome: 'relatorio.pdf' });
    } finally {
      await s.close();
    }
  });
});

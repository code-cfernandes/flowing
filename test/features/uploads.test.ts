import assert from 'node:assert/strict';
import { readdirSync, readlinkSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { type Context, contracts, createApp, detectors, Post, Router, type RouteSchemas, Type } from 'sashiko';
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

describe('F-46 · OpenAPI do upload', () => {
  it('a rota com files sai como multipart/form-data, com campos, arquivos binários e tipos aceitos', async () => {
    const app = createApp({ logger: false, shutdown: false });
    app.mount(Uploads).openapi();
    const doc = (await app.inject({ url: '/openapi.json' })).json<Record<string, any>>();
    const mp = doc.paths['/up/documentos'].post.requestBody.content['multipart/form-data'];
    assert.equal(mp.schema.properties.pdf.format, 'binary');
    assert.equal(mp.schema.properties.membro.type, 'string');
    assert.deepEqual(mp.schema.required.sort(), ['ano', 'membro', 'pdf']);
    assert.equal(mp.encoding.pdf.contentType, 'application/pdf');
    const fotos = doc.paths['/up/fotos'].post.requestBody.content['multipart/form-data'].schema.properties.fotos;
    assert.deepEqual(fotos, { type: 'array', items: { type: 'string', format: 'binary' }, maxItems: 2 });
  });
});

describe('F-46 · detector plugável', () => {
  it('detectors.fileType(fileTypeFromBuffer): o detector da aplicação substitui o padrão', async () => {
    const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const seen: number[] = [];
    // Simula o file-type: abre o ZIP e devolve o tipo exato do Word.
    const fileTypeFromBuffer = async (b: Uint8Array) => {
      seen.push(b.length);
      return b[0] === 0x50 ? { mime: DOCX } : undefined;
    };
    const rota = {
      files: { doc: { required: true, types: [DOCX] } },
      response: { 200: Type.Object({ tipo: Type.String() }) },
    } satisfies RouteSchemas;
    @Router('/d')
    class Docs {
      @Post('/', rota) up(ctx: Context<typeof rota>) {
        return { tipo: ctx.file('doc').detectedType ?? '' };
      }
    }
    const app = createApp({ logger: false, shutdown: false, uploads: { detect: detectors.fileType(fileTypeFromBuffer) } });
    app.mount(Docs);
    const s = await startServer(app);
    try {
      const zip = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], 'a.docx', { type: DOCX });
      const r = await fetch(`${s.url}/d`, { method: 'POST', body: form([['doc', zip]]) });
      assert.deepEqual(await r.json(), { tipo: DOCX });
      assert.equal(seen[0], 7, 'recebe os primeiros bytes');
    } finally {
      await s.close();
    }
  });
});

describe('F-46 · upload combinado com os recursos existentes', () => {
  const boundary = 'xSashiko';
  const multipart = (content: string) =>
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="pdf"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n${content}\r\n--${boundary}--\r\n`,
    );
  const headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
  const rota = {
    files: { pdf: { required: true, types: ['application/pdf'] } },
    response: { 200: Type.Object({ size: Type.Number() }) },
  } satisfies RouteSchemas;

  it('inject() com corpo multipart; requireSchemas aceita rota só com files', async () => {
    @Router('/i')
    class I {
      @Post('/', rota) up(ctx: Context<typeof rota>) {
        return { size: ctx.file('pdf').size };
      }
    }
    const app = createApp({ logger: false, shutdown: false, requireSchemas: true });
    app.mount(I);
    const r = await app.inject({ method: 'POST', url: '/i', headers, body: multipart(PDF) });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { size: Buffer.byteLength(PDF) });
  });

  it('guard recusa antes de ler o arquivo: 401 e nenhum temporário', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sashiko-up-guard-'));
    @Router('/g')
    class G {
      @Post('/', rota) up() {
        return { size: 0 };
      }
    }
    const app = createApp({ logger: false, shutdown: false, uploads: { tempDir: dir } });
    app.mount(G, { guards: [() => false] });
    const r = await app.inject({ method: 'POST', url: '/g', headers, body: multipart(PDF) });
    assert.ok(r.status === 401 || r.status === 403, `status ${r.status}`);
    assert.equal(temps(dir), 0);
    await rm(dir, { recursive: true, force: true });
  });

  it('onError recebe o erro do upload', async () => {
    const vistos: string[] = [];
    @Router('/h')
    class H {
      @Post('/', rota) up() {
        return { size: 0 };
      }
    }
    const app = createApp({ logger: false, shutdown: false });
    app.onError((err) => void vistos.push(`erro:${(err as { code?: string }).code}`));
    app.mount(H);
    const r = await app.inject({ method: 'POST', url: '/h', headers, body: multipart('não é pdf') });
    assert.equal(r.status, 400);
    assert.ok(
      vistos.some((v) => v.startsWith('erro:INVALID_FILE_TYPE')),
      vistos.join(),
    );
  });
});

describe('F-46 · ciclo de vida e casos de borda (revisão da 0.18.0)', () => {
  const tmpFds = () => {
    try {
      return readdirSync('/proc/self/fd').filter((f) => {
        try {
          return readlinkSync(`/proc/self/fd/${f}`).includes('sashiko-upload-');
        } catch {
          return false;
        }
      }).length;
    } catch {
      return 0; // fora do Linux, sem /proc
    }
  };
  const bigRota = {
    body: Type.Object({ tag: Type.Array(Type.String()), 'usuario[nome]': Type.String() }),
    files: { arq: { maxSize: '64kb' } },
  } satisfies RouteSchemas;
  @Router('/b')
  class Borda {
    @Post('/', bigRota) up(ctx: Context<typeof bigRota>) {
      return { tag: ctx.body.tag, nome: ctx.body['usuario[nome]'] };
    }
    @Post('/quebra', { files: { arq: { required: true } } }) quebra() {
      throw new Error('falha no handler');
    }
  }
  let s: TestServer;
  let dir: string;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sashiko-up-borda-'));
    const app = createApp({ logger: false, shutdown: false, uploads: { tempDir: dir } });
    app.mount(Borda);
    s = await startServer(app);
  });
  after(async () => {
    await s.close();
    await rm(dir, { recursive: true, force: true });
  });
  const wait = () => new Promise((r) => setTimeout(r, 100));

  it('recusa no meio do arquivo não deixa descritor aberto nem temporário', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`${s.url}/b`, { method: 'POST', body: form([['arq', new File([new Uint8Array(300 * 1024)], 'a.bin')]]) });
      assert.equal(r.status, 413);
      await r.text();
    }
    await wait();
    assert.equal(tmpFds(), 0, 'descritores fechados');
    assert.equal(temps(dir), 0, 'temporários apagados');
  });

  it('campos repetidos viram array; nomes com colchetes ficam literais', async () => {
    const r = await fetch(`${s.url}/b`, {
      method: 'POST',
      body: form([
        ['tag', 'a'],
        ['tag', 'b'],
        ['usuario[nome]', 'Ana'],
      ]),
    });
    assert.deepEqual(await r.json(), { tag: ['a', 'b'], nome: 'Ana' });
  });

  it('erro no handler: 500 e o temporário é apagado', async () => {
    const r = await fetch(`${s.url}/b/quebra`, { method: 'POST', body: form([['arq', new File(['x'], 'a.bin')]]) });
    assert.equal(r.status, 500);
    await r.text();
    await wait();
    assert.equal(temps(dir), 0);
  });

  const raw = (path: string, chunks: (string | Buffer)[], opts: { chunked?: boolean; endAfter?: boolean } = {}) =>
    new Promise<{ status: number; connection: string | undefined; ms: number }>((resolve, reject) => {
      const started = Date.now();
      const b = 'rawB';
      const req = request(`${s.url}${path}`, {
        method: 'POST',
        headers: {
          'content-type': `multipart/form-data; boundary=${b}`,
          ...(opts.chunked
            ? { 'transfer-encoding': 'chunked' }
            : { 'content-length': String(chunks.reduce((n, c) => n + Buffer.byteLength(c), 0) + (opts.endAfter === false ? 1000 : 0)) }),
        },
      });
      req.on('response', (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, connection: res.headers.connection, ms: Date.now() - started });
      });
      req.on('error', reject);
      for (const c of chunks) req.write(c);
      if (opts.endAfter !== false) req.end();
    });
  const part = (name: string, body: string | Buffer) => [
    `--rawB\r\nContent-Disposition: form-data; name="${name}"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    body,
  ];

  it('Transfer-Encoding: chunked: arquivo grande recusado com 413', async () => {
    const r = await raw('/b', [...part('arq', Buffer.alloc(200 * 1024)), '\r\n--rawB--\r\n'], { chunked: true });
    assert.equal(r.status, 413);
  });

  it('corpo multipart truncado: 400 e nenhum temporário', async () => {
    const r = await raw('/b', [...part('arq', 'metade do arquivo, sem o boundary final')]);
    assert.equal(r.status, 400);
    await wait();
    assert.equal(temps(dir), 0);
  });

  it('cliente lento depois da recusa: a resposta não espera o corpo todo e fecha a conexão', async () => {
    const r = await raw('/b', [...part('arq', Buffer.alloc(100 * 1024))], { endAfter: false });
    assert.equal(r.status, 413);
    assert.equal(r.connection, 'close');
    assert.ok(r.ms < 4000, `respondeu em ${r.ms} ms`);
  });
});

import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { Busboy, type BusboyInstance } from '@fastify/busboy';
import { filetypeinfo } from 'magic-bytes.js';
import type { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import type { ContentDetector, FileInfo, FileRule, FileRules, Size, UploadedFile, UploadsOptions } from './types.ts';

/** Quantos bytes do começo do arquivo vão para a detecção do conteúdo e para o `verify`. */
const HEAD_BYTES = 4100;

const UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

/** `'5mb'` → 5242880. Erro de configuração aparece no registro da rota. */
export function parseSize(size: Size, where: string): number {
  if (typeof size === 'number' && Number.isFinite(size) && size > 0) return Math.floor(size);
  const m = typeof size === 'string' ? /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(size.trim()) : null;
  if (!m) throw new Error(`[sashiko] ${where}: invalid size ${JSON.stringify(size)} (use a number of bytes or '5mb').`);
  return Math.floor(Number(m[1]) * UNITS[m[2]!.toLowerCase()]!);
}

/** Detector padrão: a tabela de assinaturas da `magic-bytes.js`. */
const magicBytes: ContentDetector = (head) => filetypeinfo(head).map((t) => t.mime ?? t.typename);

/**
 * Detectores de conteúdo (F-46):
 * - `detectors.magicBytes()`: o padrão, sem dependências (centenas de assinaturas; documentos do Office só como ZIP).
 * - `detectors.fileType(fileTypeFromBuffer)`: o `file-type`, instalado pela aplicação, para conferências mais completas
 *   (abre o ZIP para confirmar `.docx`, `.xlsx`, `.pptx`).
 */
export const detectors = {
  magicBytes: (): ContentDetector => magicBytes,
  fileType:
    (fileTypeFromBuffer: (buffer: Uint8Array) => Promise<{ mime: string } | undefined>): ContentDetector =>
    async (head) => {
      const found = await fileTypeFromBuffer(head);
      return found ? [found.mime] : [];
    },
};

/** Limites globais resolvidos, em bytes e contagens. */
export interface UploadLimits {
  readonly fileSize: number;
  readonly files: number;
  readonly fields: number;
  readonly fieldSize: number;
  readonly parts: number;
}

export interface UploadSettings {
  readonly limits: UploadLimits;
  readonly tempDir: string;
  readonly detect: ContentDetector;
}

export function uploadSettings(opts: UploadsOptions = {}): UploadSettings {
  const l = opts.limits ?? {};
  return {
    limits: {
      fileSize: parseSize(l.fileSize ?? '10mb', 'uploads.limits.fileSize'),
      files: l.files ?? 10,
      fields: l.fields ?? 50,
      fieldSize: parseSize(l.fieldSize ?? '100kb', 'uploads.limits.fieldSize'),
      parts: l.parts ?? 60,
    },
    tempDir: opts.tempDir ?? tmpdir(),
    detect: opts.detect ?? magicBytes,
  };
}

/** As regras de um campo, resolvidas no registro da rota. */
interface CompiledRule {
  readonly required: boolean;
  readonly maxSize: number;
  readonly maxCount: number;
  readonly types: readonly string[] | undefined;
  readonly verify: FileRule['verify'];
}

/** O plano de upload de uma rota, montado no registro (nada por requisição). */
export interface UploadPlan {
  readonly rules: ReadonlyMap<string, CompiledRule>;
  readonly settings: UploadSettings;
  /** O maior tamanho permitido entre os campos: o limite de leitura do busboy. */
  readonly largest: number;
}

/**
 * Resolve o `files` do contrato. Uma rota que tenta ampliar um limite global falha aqui, no registro, em vez de ser
 * ignorada em silêncio.
 */
export function uploadPlan(files: FileRules, settings: UploadSettings, where: string): UploadPlan {
  const rules = new Map<string, CompiledRule>();
  for (const [name, rule] of Object.entries(files)) {
    const maxSize = rule.maxSize === undefined ? settings.limits.fileSize : parseSize(rule.maxSize, `${where} files.${name}.maxSize`);
    if (maxSize > settings.limits.fileSize) {
      throw new Error(
        `[sashiko] ${where}: files.${name}.maxSize (${maxSize} bytes) is larger than uploads.limits.fileSize ` +
          `(${settings.limits.fileSize} bytes); a route can only restrict the global limits.`,
      );
    }
    const maxCount = rule.maxCount ?? 1;
    if (!Number.isInteger(maxCount) || maxCount < 1)
      throw new Error(`[sashiko] ${where}: files.${name}.maxCount must be a positive integer.`);
    rules.set(name, { required: rule.required ?? false, maxSize, maxCount, types: rule.types, verify: rule.verify });
  }
  let largest = 0;
  for (const r of rules.values()) largest = Math.max(largest, r.maxSize);
  return { rules, settings, largest };
}

/** Tipos sem assinatura de conteúdo: só o tipo declarado é conferido. */
const TEXT_LIKE = /^(text\/|application\/(json|xml|csv|x-ndjson|ld\+json)$|image\/svg\+xml$)/;
/** Formatos que são um ZIP por dentro: o detector padrão só os reconhece como ZIP. */
const ZIP_FAMILY = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/epub+zip',
  'application/java-archive',
]);

const matches = (type: string, accepted: readonly string[]): boolean =>
  accepted.some((a) => a === '*/*' || a === type || (a.endsWith('/*') && type.startsWith(a.slice(0, -1))));

class Spooled implements UploadedFile {
  readonly detectedType: string | undefined;
  #read = false;
  constructor(
    readonly fieldname: string,
    readonly filename: string,
    readonly mimetype: string,
    readonly encoding: string,
    readonly size: number,
    detected: string | undefined,
    private readonly path: string,
  ) {
    this.detectedType = detected;
  }
  stream(): Readable {
    if (this.#read) throw new Error(`[sashiko] the file "${this.fieldname}" was already read; stream() can be called only once.`);
    this.#read = true;
    return createReadStream(this.path);
  }
  buffer(): Promise<Buffer> {
    return readFile(this.path);
  }
}

/** O que a recepção deixa no `ctx`: os campos de texto (o body) e os arquivos por nome de campo. */
export interface Received {
  readonly fields: Record<string, string | string[]>;
  readonly files: ReadonlyMap<string, readonly UploadedFile[]>;
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Lê um `multipart/form-data` (F-46). Os arquivos vão para temporários com nome gerado, apagados quando a resposta
 * termina (sucesso, erro ou cancelamento). Limites, tipos, conteúdo e obrigatórios são conferidos aqui, antes do
 * handler; os campos de texto são validados depois pelo contrato `body`.
 */
export function receiveUploads(ctx: Context, plan: UploadPlan): Promise<Received> {
  const contentType = ctx.req.headers['content-type'] ?? '';
  if (!/^multipart\/form-data\b/i.test(contentType)) {
    return Promise.reject(new HttpError(415, 'Expected multipart/form-data', 'UNSUPPORTED_MEDIA_TYPE'));
  }
  const { limits, tempDir } = plan.settings;
  const temps: string[] = [];
  // Os temporários somem quando a resposta termina, qualquer que seja o caminho.
  ctx.res.once('close', () => {
    for (const path of temps) unlink(path).catch(() => {});
  });

  return new Promise<Received>((resolve, reject) => {
    const fields: Record<string, string | string[]> = {};
    const files = new Map<string, Spooled[]>();
    const counts = new Map<string, number>();
    const pending: Promise<void>[] = [];
    let failed: HttpError | undefined;

    let settled = false;
    const fail = (err: HttpError) => {
      if (failed || settled) return;
      failed = err;
      ctx.req.unpipe(parser);
      discardRest(ctx, () => reject(err));
    };

    let parser: BusboyInstance;
    try {
      parser = new Busboy({
        headers: ctx.req.headers as { 'content-type': string },
        limits: {
          fileSize: plan.largest,
          files: limits.files,
          fields: limits.fields,
          fieldSize: limits.fieldSize,
          parts: limits.parts,
        },
      });
    } catch {
      return reject(new HttpError(400, 'Invalid multipart body', 'INVALID_MULTIPART'));
    }

    parser.on('field', (name: string, value: string, _nameTruncated: boolean, valueTruncated: boolean) => {
      if (failed) return;
      if (valueTruncated) return fail(new HttpError(413, `Field "${name}" is too large`, 'FIELD_TOO_LARGE'));
      if (UNSAFE_KEYS.has(name)) return;
      const prev = fields[name];
      fields[name] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
    });

    parser.on('file', (name: string, stream: Readable, filename: string, encoding: string, mimetype: string) => {
      const rule = plan.rules.get(name);
      if (failed || !rule) {
        stream.resume();
        if (!rule) fail(new HttpError(400, `Unexpected file field "${name}"`, 'UNEXPECTED_FILE'));
        return;
      }
      // Contado na chegada: os arquivos terminam de gravar fora de ordem.
      const count = (counts.get(name) ?? 0) + 1;
      counts.set(name, count);
      if (count > rule.maxCount) {
        stream.resume();
        return fail(new HttpError(400, `Too many files in "${name}" (max ${rule.maxCount})`, 'TOO_MANY_FILES'));
      }
      const path = join(tempDir, `sashiko-upload-${randomUUID()}`);
      temps.push(path);
      const out = createWriteStream(path);
      const head: Buffer[] = [];
      let headSize = 0;
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (headSize < HEAD_BYTES) {
          head.push(chunk);
          headSize += chunk.length;
        }
        if (size > rule.maxSize) {
          stream.unpipe(out);
          stream.resume();
          fail(new HttpError(413, `File "${name}" is too large (max ${rule.maxSize} bytes)`, 'FILE_TOO_LARGE'));
        }
      });
      stream.on('limit', () => fail(new HttpError(413, `File "${name}" is too large (max ${rule.maxSize} bytes)`, 'FILE_TOO_LARGE')));
      stream.pipe(out);
      pending.push(
        new Promise<void>((done, error) => {
          out.on('finish', done);
          out.on('error', error);
        })
          .then(async () => {
            if (failed) return;
            const bytes = Buffer.concat(head).subarray(0, HEAD_BYTES);
            const detected = await checkContent(name, rule, mimetype, bytes, plan.settings.detect, {
              fieldname: name,
              filename,
              mimetype,
              encoding,
              size,
              detectedType: undefined,
            });
            const list = files.get(name);
            const file = new Spooled(name, filename, mimetype, encoding, size, detected, path);
            if (list) list.push(file);
            else files.set(name, [file]);
          })
          .catch((err: unknown) => fail(err instanceof HttpError ? err : new HttpError(400, 'Invalid file', 'INVALID_FILE'))),
      );
    });

    parser.on('partsLimit', () => fail(new HttpError(413, 'Too many parts', 'TOO_MANY_PARTS')));
    parser.on('filesLimit', () => fail(new HttpError(413, 'Too many files', 'TOO_MANY_FILES')));
    parser.on('fieldsLimit', () => fail(new HttpError(413, 'Too many fields', 'TOO_MANY_FIELDS')));
    parser.on('error', () => fail(new HttpError(400, 'Invalid multipart body', 'INVALID_MULTIPART')));
    parser.on('finish', () => {
      Promise.all(pending)
        .then(() => {
          if (failed) return;
          for (const [name, rule] of plan.rules) {
            if (rule.required && !files.get(name)?.length) {
              return fail(new HttpError(400, `File "${name}" is required`, 'FILE_REQUIRED'));
            }
          }
          settled = true;
          resolve({ fields, files });
        })
        .catch((err: unknown) => fail(err instanceof HttpError ? err : new HttpError(400, 'Invalid file', 'INVALID_FILE')));
    });
    // O cliente desistiu no meio do envio: nada a validar, só limpar (o `close` da resposta apaga os temporários).
    // A conexão caiu antes da resposta (o `aborted` da requisição é obsoleto e dispara no `inject()`).
    ctx.res.once('close', () => fail(new HttpError(400, 'Upload aborted', 'UPLOAD_ABORTED')));
    ctx.req.once('error', () => fail(new HttpError(400, 'Upload aborted', 'UPLOAD_ABORTED')));
    ctx.req.pipe(parser);
  });
}

/** Quanto do corpo recusado ainda vale ler e descartar antes de responder, para manter a conexão. */
const DRAIN_LIMIT = 1024 * 1024;

/**
 * Depois de recusar um upload, descarta o resto do corpo antes de responder. Responder e fechar com o cliente ainda
 * enviando faz o cliente receber EPIPE em vez do 400/413. Acima de `DRAIN_LIMIT`, responde já com
 * `Connection: close` (como o limite do body JSON, B-12): não vale gastar banda com o que será jogado fora.
 */
function discardRest(ctx: Context, respond: () => void): void {
  const req = ctx.req;
  if (req.readableEnded || req.destroyed) {
    respond();
    return;
  }
  let drained = 0;
  let done = false;
  const finish = (close: boolean) => {
    if (done) return;
    done = true;
    req.off('data', onData);
    if (close && !ctx.res.headersSent) ctx.res.setHeader('Connection', 'close');
    respond();
  };
  const onData = (chunk: Buffer) => {
    drained += chunk.length;
    if (drained > DRAIN_LIMIT) finish(true);
  };
  req.on('data', onData);
  req.once('end', () => finish(false));
  req.once('close', () => finish(true));
  req.resume();
}

/** Confere o tipo declarado e, quando possível, o conteúdo; depois o `verify`. Devolve o tipo detectado. */
async function checkContent(
  name: string,
  rule: CompiledRule,
  declared: string,
  head: Buffer,
  detect: ContentDetector,
  info: FileInfo,
): Promise<string | undefined> {
  const reject = (why: string): never => {
    throw new HttpError(400, `File "${name}" ${why}`, 'INVALID_FILE_TYPE');
  };
  let detectedType: string | undefined;
  if (rule.types) {
    const type = declared.toLowerCase();
    if (!matches(type, rule.types)) reject(`has type "${declared}", which is not accepted`);
    const candidates = await detect(head);
    detectedType = candidates[0];
    if (candidates.length > 0) {
      const ok = candidates.some((c) => matches(c, rule.types!)) || (ZIP_FAMILY.has(type) && candidates.includes('application/zip'));
      if (!ok) reject(`content does not match its type (detected "${candidates[0]}")`);
    } else if (!TEXT_LIKE.test(type) && !rule.verify) {
      reject('content could not be recognized as an accepted type');
    }
  }
  if (rule.verify) {
    let ok = false;
    try {
      ok = await rule.verify(new Uint8Array(head), { ...info, detectedType });
    } catch {
      ok = false;
    }
    if (!ok) reject('was rejected by its verify rule');
  }
  return detectedType;
}

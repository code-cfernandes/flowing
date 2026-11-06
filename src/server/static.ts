import { createReadStream, realpathSync, type Stats, statSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { type Context, kRawSend } from '../core/context.ts';
import { HttpError } from '../core/errors.ts';
import { contentTypeFor } from '../utils/mime.ts';

/** Opções comuns a `app.static()` e `ctx.sendFile()` (F-13). */
export interface FileOptions {
  /** `Cache-Control: max-age`, em segundos ou como `'7d'`, `'12h'`, `'30m'`, `'10s'`. Padrão: 0 (revalida sempre). */
  maxAge?: number | string;
  /** Acrescenta `immutable` ao `Cache-Control`, para arquivos com hash no nome. */
  immutable?: boolean;
  /** `ETag` fraco (tamanho + data de modificação), com 304 para `If-None-Match`. Padrão: `true`. */
  etag?: boolean;
  /** `Last-Modified`, com 304 para `If-Modified-Since`. Padrão: `true`. */
  lastModified?: boolean;
  /** Tipos por extensão, somados à tabela interna: `{ glb: 'model/gltf-binary' }`. */
  mimeTypes?: Readonly<Record<string, string>>;
}

export interface StaticOptions extends FileOptions {
  /** Arquivo servido para um diretório. Padrão: `'index.html'`; `false` desliga. Diretórios nunca são listados. */
  index?: string | false;
  /**
   * SPA: arquivo (relativo à raiz) servido quando o path pedido não existe **e não tem extensão**
   * (`/pedidos/42` → `index.html`, mas `/app.js` inexistente continua 404). Sai com `no-cache`.
   */
  fallback?: string;
  /** Arquivos e pastas que começam com `.` (`.env`, `.git`): `'deny'` responde 404 (padrão) ou `'allow'`. */
  dotfiles?: 'deny' | 'allow';
}

export interface SendFileOptions extends FileOptions {
  /** Raiz que contém o arquivo; com ela, o path é relativo e não pode sair dela. Sem `root`, o path precisa ser absoluto. */
  root?: string;
  /** `Content-Disposition: attachment`. `true` usa o nome do arquivo; uma string define o nome do download. */
  download?: boolean | string;
}

const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };

export function parseMaxAge(value: number | string | undefined): number {
  if (value === undefined) return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error(`[sashiko] invalid maxAge ${value}.`);
    return Math.floor(value);
  }
  const m = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!m) throw new Error(`[sashiko] invalid maxAge "${value}"; use seconds or "10s", "30m", "12h", "7d".`);
  return Number(m[1]) * UNITS[m[2]!]!;
}

/** Raiz real (symlinks resolvidos), conferida na configuração: um diretório que não existe falha cedo. */
export function resolveRoot(root: string): string {
  let real: string;
  try {
    real = realpathSync(resolve(root));
  } catch {
    throw new Error(`[sashiko] static root "${root}" does not exist.`);
  }
  if (!statSync(real).isDirectory()) throw new Error(`[sashiko] static root "${root}" is not a directory.`);
  return real;
}

const notFound = () => new HttpError(404, 'Not Found', 'NOT_FOUND');

/**
 * Caminho dentro da raiz, ou `undefined` se a requisição tentar sair dela (path traversal) (F-13):
 * byte nulo, barra invertida e segmentos `..` são recusados antes de resolver, e o resultado real
 * (depois de seguir symlinks) precisa continuar dentro da raiz.
 */
async function insideRoot(root: string, relative: string, dotfiles: 'deny' | 'allow'): Promise<string | undefined> {
  if (relative.includes('\0') || relative.includes('\\')) return undefined;
  const segments = relative.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) return undefined;
  if (dotfiles === 'deny' && segments.some((s) => s.startsWith('.'))) return undefined;
  const candidate = resolve(root, ...segments);
  if (candidate !== root && !candidate.startsWith(root + sep)) return undefined;
  try {
    const real = await realpath(candidate);
    return real === root || real.startsWith(root + sep) ? real : undefined;
  } catch {
    return candidate; // não existe: o stat responde 404 adiante
  }
}

async function fileStat(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

const etagOf = (s: Stats) => `W/"${s.size.toString(16)}-${Math.floor(s.mtimeMs).toString(16)}"`;

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * `bytes=a-b`, `bytes=a-` ou `bytes=-n` sobre `size`. `undefined` = não satisfazível (416); `null` = ignorar
 * e enviar o arquivo inteiro (outra unidade, vários intervalos ou sintaxe que não entendemos, RFC 9110 §14.2).
 */
function parseRange(header: string, size: number): { start: number; end: number } | undefined | null {
  const value = header.trim();
  if (!/^bytes=/i.test(value) || value.includes(',')) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!m) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return undefined;
  let start: number;
  let end: number;
  if (a === '') {
    const n = Number(b);
    if (n === 0) return undefined;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  return start > end || start >= size ? undefined : { start, end };
}

/** Envia um arquivo já resolvido e conferido, com cache condicional e `Range` (F-13). */
export async function sendResolvedFile(
  ctx: Context,
  path: string,
  s: Stats,
  opts: FileOptions & { download?: boolean | string; noCache?: boolean },
): Promise<void> {
  const res = ctx.res;
  const type = contentTypeFor(path, opts.mimeTypes);
  const etag = opts.etag === false ? undefined : etagOf(s);
  const modified = opts.lastModified === false ? undefined : new Date(Math.floor(s.mtimeMs / 1000) * 1000);

  if (etag) res.setHeader('ETag', etag);
  if (modified) res.setHeader('Last-Modified', modified.toUTCString());
  const maxAge = parseMaxAge(opts.maxAge);
  res.setHeader('Cache-Control', opts.noCache ? 'no-cache' : `public, max-age=${maxAge}${opts.immutable ? ', immutable' : ''}`);
  res.setHeader('Accept-Ranges', 'bytes');
  if (opts.download) {
    const name = typeof opts.download === 'string' ? opts.download : (path.split(sep).pop() ?? 'download');
    res.setHeader('Content-Disposition', contentDisposition(name));
  }

  // Condicionais (RFC 9110): If-None-Match prevalece sobre If-Modified-Since.
  const inm = ctx.get('if-none-match');
  const ims = ctx.get('if-modified-since');
  const fresh = inm
    ? etag !== undefined && inm.split(',').some((t) => t.trim() === '*' || t.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''))
    : ims !== undefined && modified !== undefined && !Number.isNaN(Date.parse(ims)) && modified.getTime() <= Date.parse(ims);
  if (fresh) {
    res.statusCode = 304;
    res.removeHeader('Content-Type');
    return void res.end();
  }

  let start = 0;
  let end = s.size - 1;
  const rangeHeader = ctx.get('range');
  const ifRange = ctx.get('if-range');
  // Range só vale para GET. If-Range exige comparação forte: nossos ETags são fracos e nunca a satisfazem;
  // uma data precisa ser exatamente o Last-Modified (RFC 9110 §13.1.5).
  const ifRangeOk =
    !ifRange ||
    (!ifRange.startsWith('"') && !ifRange.startsWith('W/') && modified !== undefined && Date.parse(ifRange) === modified.getTime());
  const rangeApplies = ctx.method === 'GET' && rangeHeader !== undefined && ifRangeOk;
  if (rangeApplies && s.size > 0) {
    const range = parseRange(rangeHeader, s.size);
    if (range === undefined) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${s.size}`);
      return void res.end();
    }
    if (range) {
      ({ start, end } = range);
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${s.size}`);
    }
  }

  res.setHeader('Content-Length', String(s.size === 0 ? 0 : end - start + 1));
  if (ctx.method === 'HEAD' || s.size === 0) {
    res.setHeader('Content-Type', type);
    return void res.end();
  }
  ctx[kRawSend](createReadStream(path, { start, end }), type);
}

/** `ctx.sendFile()`: confere o caminho e envia (F-13). */
export async function sendFile(ctx: Context, path: string, opts: SendFileOptions = {}): Promise<void> {
  let full: string | undefined;
  if (opts.root !== undefined) {
    full = await insideRoot(resolveRoot(opts.root), path, 'deny');
  } else {
    if (!isAbsolute(path)) throw new Error('[sashiko] ctx.sendFile(): use an absolute path, or pass { root } with a relative one.');
    full = path;
  }
  const s = full ? await fileStat(full) : undefined;
  if (!full || !s?.isFile()) throw notFound();
  await sendResolvedFile(ctx, full, s, opts);
}

/** Handler de `app.static()`: resolve o resto do path dentro da raiz, com índice e fallback de SPA. */
export function staticHandler(rootInput: string, opts: StaticOptions): (ctx: Context) => Promise<void> {
  const root = resolveRoot(rootInput);
  parseMaxAge(opts.maxAge); // valida já
  const dotfiles = opts.dotfiles ?? 'deny';
  const index = opts.index === undefined ? 'index.html' : opts.index;
  return async (ctx) => {
    const rest = (ctx.params as Record<string, string>)['*'] ?? '';
    let full = await insideRoot(root, rest, dotfiles);
    let s = full ? await fileStat(full) : undefined;
    if (full && s?.isDirectory()) {
      full = index ? await insideRoot(root, `${rest}/${index}`, dotfiles) : undefined;
      s = full ? await fileStat(full) : undefined;
    }
    if (full && s?.isFile()) return sendResolvedFile(ctx, full, s, opts);

    // SPA: só para paths sem extensão, para um asset que falta continuar 404.
    const last = rest.split('/').pop() ?? '';
    if (opts.fallback && full !== undefined && !last.includes('.')) {
      const fb = await insideRoot(root, opts.fallback, 'allow');
      const fs = fb ? await fileStat(fb) : undefined;
      if (fb && fs?.isFile()) return sendResolvedFile(ctx, fb, fs, { ...opts, noCache: true });
    }
    throw notFound();
  };
}

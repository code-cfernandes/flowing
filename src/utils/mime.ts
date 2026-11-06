/**
 * Tipos de conteúdo por extensão, sem dependência (F-13). Cobre o que uma API e uma SPA servem; o resto
 * sai como `application/octet-stream` (com `nosniff`, o navegador não tenta adivinhar). Acrescente tipos
 * com a opção `mimeTypes` do `static()`/`sendFile()`.
 */
const TYPES: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  json: 'application/json',
  map: 'application/json',
  webmanifest: 'application/manifest+json',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
  wasm: 'application/wasm',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

/** Tipos de texto recebem `charset=utf-8`. */
const TEXT = /^(text\/|application\/(json|manifest\+json|xml|yaml|javascript))|\+xml$|\+json$/;

export function contentTypeFor(filename: string, extra: Readonly<Record<string, string>> = {}): string {
  const dot = filename.lastIndexOf('.');
  const ext = dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
  const type = extra[ext] ?? TYPES[ext] ?? 'application/octet-stream';
  return TEXT.test(type) && !type.includes('charset') ? `${type}; charset=utf-8` : type;
}

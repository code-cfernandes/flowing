import type { Readable } from 'node:stream';

/** Tamanho em bytes, ou com unidade: `'512kb'`, `'5mb'`, `'1gb'` (base 1024). */
export type Size = number | `${number}${'b' | 'kb' | 'mb' | 'gb'}`;

/**
 * Regras de um campo de arquivo no contrato da rota (F-46): `files: { pdf: { required: true, maxSize: '5mb' } }`.
 * Tudo é conferido antes do handler; o arquivo inválido gera 400 ou 413 em Problem Details.
 */
export interface FileRule {
  /** O campo precisa ter pelo menos um arquivo. Padrão: `false`. */
  required?: boolean;
  /** Tamanho máximo de cada arquivo. Não pode passar do limite global (`uploads.limits.fileSize`). */
  maxSize?: Size;
  /** Quantos arquivos o campo aceita. Padrão: 1. Use `ctx.files(nome)` quando for mais de um. */
  maxCount?: number;
  /**
   * Tipos aceitos (`'application/pdf'`, `'image/*'`). Confere o tipo declarado pelo cliente e, quando o formato tem
   * assinatura conhecida, também os primeiros bytes do arquivo (um executável com nome `.pdf` é recusado). Formatos de
   * texto (CSV, JSON) não têm assinatura: só o tipo declarado é conferido.
   */
  types?: readonly string[];
  /**
   * Conferência própria do conteúdo, depois dos tipos: recebe os primeiros bytes do arquivo. `false` (ou um erro)
   * recusa o arquivo com 400. Para regras que a detecção por assinatura não cobre.
   */
  verify?: (head: Uint8Array, file: FileInfo) => boolean | Promise<boolean>;
}

/** Os campos de arquivo de um contrato: nome do campo → regras. */
export type FileRules = Readonly<Record<string, FileRule>>;

/** O que se sabe de um arquivo recebido. */
export interface FileInfo {
  /** O nome do campo no formulário. */
  readonly fieldname: string;
  /** O nome enviado pelo cliente. É só um metadado: nunca o use como caminho no disco. */
  readonly filename: string;
  /** O tipo declarado pelo cliente. */
  readonly mimetype: string;
  /** O tipo detectado pelo conteúdo, quando o formato tem assinatura conhecida. */
  readonly detectedType: string | undefined;
  readonly encoding: string;
  /** O tamanho efetivamente recebido, em bytes. */
  readonly size: number;
}

/** Um arquivo recebido e validado, guardado num arquivo temporário até o fim da resposta. */
export interface UploadedFile extends FileInfo {
  /** O conteúdo como stream. Uso único: uma segunda chamada lança. */
  stream(): Readable;
  /** O conteúdo inteiro na memória. Prefira `stream()` para arquivos grandes. */
  buffer(): Promise<Buffer>;
}

/**
 * Detecta o tipo pelo conteúdo: recebe os primeiros bytes e devolve os tipos possíveis (vazio se não reconhece).
 * O padrão usa a `magic-bytes.js`; `detectors.fileType(fileTypeFromBuffer)` liga o `file-type`.
 */
export type ContentDetector = (head: Uint8Array) => readonly string[] | Promise<readonly string[]>;

/** Configuração de upload do app (`createApp({ uploads })`). */
export interface UploadsOptions {
  /** Limites globais; o contrato de cada rota só pode restringi-los. */
  limits?: {
    /** Tamanho máximo de cada arquivo. Padrão: `'10mb'`. */
    fileSize?: Size;
    /** Arquivos por requisição. Padrão: 10. */
    files?: number;
    /** Campos de texto por requisição. Padrão: 50. */
    fields?: number;
    /** Tamanho máximo de cada campo de texto. Padrão: `'100kb'`. */
    fieldSize?: Size;
    /** Partes (campos + arquivos) por requisição. Padrão: 60. */
    parts?: number;
  };
  /** Pasta dos arquivos temporários. Padrão: a pasta temporária do sistema. */
  tempDir?: string;
  /** Detector de conteúdo. Padrão: `detectors.magicBytes()`. */
  detect?: ContentDetector;
}

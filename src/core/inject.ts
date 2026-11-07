import http from 'node:http';
import { Socket } from 'node:net';
import { kHeadersAt } from './symbols.ts';

export interface InjectOptions {
  method?: string;
  /** Caminho com query string, ex.: `/users?limit=10`. */
  url: string;
  headers?: Record<string, string>;
  /** Objetos são enviados como JSON (com `content-type` automático); strings e Buffers vão crus. */
  body?: unknown;
  /** IP simulado do cliente (`ctx.ip`). Padrão: `127.0.0.1`. */
  remoteAddress?: string;
}

export interface InjectResponse {
  status: number;
  headers: http.OutgoingHttpHeaders;
  /** Corpo como texto. */
  body: string;
  json<T = unknown>(): T;
}

type Listener = (req: http.IncomingMessage, res: http.ServerResponse) => void;

/**
 * Executa uma requisição direto no listener do app, sem abrir porta nem usar a rede (F-09).
 * Cria `IncomingMessage`/`ServerResponse` reais sobre um socket desconectado e captura o que
 * o app escreve na resposta.
 */
export function inject(listener: Listener, opts: InjectOptions): Promise<InjectResponse> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    Object.defineProperty(socket, 'remoteAddress', { value: opts.remoteAddress ?? '127.0.0.1' });

    const req = new http.IncomingMessage(socket);
    req.method = (opts.method ?? 'GET').toUpperCase();
    req.url = opts.url;
    req.httpVersion = '1.1';
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 1;

    const headers: Record<string, string> = { host: 'localhost' };
    for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k.toLowerCase()] = v;

    let payload: Buffer | undefined;
    if (opts.body !== undefined) {
      if (typeof opts.body === 'string' || Buffer.isBuffer(opts.body)) {
        payload = Buffer.from(opts.body);
      } else {
        payload = Buffer.from(JSON.stringify(opts.body));
        headers['content-type'] ??= 'application/json';
      }
      headers['content-length'] = String(payload.length);
    }
    req.headers = headers;
    if (payload) req.push(payload);
    req.push(null);

    const res = new http.ServerResponse(req);
    // O instante dos headers, para o `ttfbMs` (F-38); no `listen()`, quem grava é o protótipo da resposta.
    const writeHead = res.writeHead as (...args: unknown[]) => http.ServerResponse;
    (res as { writeHead: unknown }).writeHead = function (this: http.ServerResponse, ...args: unknown[]) {
      (this as unknown as Record<symbol, number>)[kHeadersAt] ??= performance.now();
      return writeHead.apply(this, args);
    };
    const chunks: Buffer[] = [];
    const noBody = req.method === 'HEAD';
    const collect = (chunk: unknown, encoding?: unknown) => {
      if (noBody || chunk === undefined || chunk === null || typeof chunk === 'function') return;
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), (typeof encoding === 'string' ? encoding : 'utf8') as BufferEncoding),
      );
    };

    // Sem socket conectado, o 'finish' não dispara: interceptamos write/end para capturar o corpo
    // e chamamos os originais para manter headersSent/writableEnded corretos.
    const write = res.write.bind(res) as (...a: unknown[]) => boolean;
    const end = res.end.bind(res) as (...a: unknown[]) => http.ServerResponse;
    res.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
      collect(chunk, encoding);
      return write(chunk, encoding, cb);
    }) as typeof res.write;
    res.end = ((chunk?: unknown, encoding?: unknown, cb?: unknown) => {
      collect(chunk, encoding);
      const out = end(chunk, encoding, cb);
      const body = Buffer.concat(chunks).toString('utf8');
      // Sem socket, 'finish' e 'close' nunca seriam emitidos: emite os dois, como numa conexão real,
      // para `onResponse`, `logRequests` e a limpeza das respostas em andamento rodarem também no inject.
      setImmediate(() => {
        res.emit('finish');
        res.emit('close');
      });
      resolve({
        status: res.statusCode,
        headers: res.getHeaders(),
        body,
        json: <T>() => JSON.parse(body) as T,
      });
      return out;
    }) as typeof res.end;

    try {
      listener(req, res);
    } catch (err) {
      reject(err);
    }
  });
}

import type { AddressInfo } from 'node:net';
import type { SashikoApp } from 'sashiko';

export interface TestServer {
  url: string;
  close(): Promise<void>;
}

/**
 * Sobe o app numa porta efêmera (0) para testes que precisam de rede real
 * (sockets crus, timeouts, keep-alive). Para o resto, prefira `app.inject()`.
 */
export async function startServer(app: SashikoApp): Promise<TestServer> {
  const server = await app.listen(0);
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => app.close() };
}

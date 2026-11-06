import type { AddressInfo } from 'node:net';
import type { PicoDecorApp } from 'picodecor';

export interface TestServer {
  url: string;
  close(): Promise<void>;
}

/** Sobe o app numa porta efêmera (0) para testes de integração. */
export async function startServer(app: PicoDecorApp): Promise<TestServer> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

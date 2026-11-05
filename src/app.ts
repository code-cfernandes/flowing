import http, { ServerResponse, type RequestOptions } from 'node:http';
import { cors } from './decorators/cors.ts';
import { timer } from './decorators/log.ts';

const hostname = '127.0.0.1';
const port = 3000;

const server = http.createServer((req, res) => {
  console.log('Chamando')
  new Service().greet(req, res);
});


// Função sleep que retorna uma Promise
function sleep(ms: number) {
   return new Promise(resolve => setTimeout(resolve, ms));
}
class Service {
  @timer
  @cors('*')
  greet(req: RequestOptions, res: ServerResponse) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Hello, World!\n <ul><li>In TypeScript</li></ul>');
  }
  @timer
  async lazy(name: string) {
    await sleep(500)
    return `Olá, ${name}`;
  }
}

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});
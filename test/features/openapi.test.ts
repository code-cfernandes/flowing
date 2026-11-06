import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Context, createApp, Delete, Get, type Middleware, Post, Router, toOpenAPIPath, Type, unauthorized } from 'sashiko';

const User = Type.Object({ id: Type.String(), name: Type.String() });

@Router('/orgs/:org/users')
class Users {
  @Get('/', {
    params: Type.Object({ org: Type.String() }),
    query: Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1 })), tag: Type.String() }),
    response: { 200: { contentType: ['application/json', 'text/csv'], schema: Type.Array(User) } },
  })
  list() { return []; }

  @Post('/', {
    params: Type.Object({ org: Type.String() }),
    headers: Type.Object({ 'x-tenant': Type.String() }),
    body: Type.Object({ name: Type.String() }),
    response: { 201: User },
  })
  create() { return { id: '1', name: 'Ana' }; }

  @Delete('/:id(^\\d+)', { params: Type.Object({ org: Type.String(), id: Type.String() }), response: { 204: Type.Null() } })
  remove(ctx: Context) { ctx.status(204).res.end(); }
}

@Router('/health')
class Health {
  @Get('/') check() { return { ok: true }; }
}

type Doc = { openapi: string; info: unknown; servers?: unknown; paths: Record<string, Record<string, any>>; components?: any };

describe('F-16 · documento OpenAPI 3.1', () => {
  const app = createApp({ logger: false }).mount(Users).mount(Health);
  const doc = app.openapiDocument({ info: { title: 'Exemplo', version: '1.2.3' }, servers: [{ url: 'https://api.exemplo.dev' }] }) as Doc;

  it('cabeçalho, servers e paths convertidos', () => {
    assert.equal(doc.openapi, '3.1.0');
    assert.deepEqual(doc.info, { title: 'Exemplo', version: '1.2.3' });
    assert.deepEqual(doc.servers, [{ url: 'https://api.exemplo.dev' }]);
    assert.deepEqual(Object.keys(doc.paths).sort(), ['/health', '/orgs/{org}/users', '/orgs/{org}/users/{id}']);
  });

  it('parâmetros de path, query e header, com required', () => {
    const list = doc.paths['/orgs/{org}/users']!.get;
    assert.equal(list.operationId, 'Users.list');
    assert.deepEqual(list.tags, ['Users']);
    assert.deepEqual(list.parameters.map((p: any) => [p.in, p.name, p.required]), [
      ['path', 'org', true], ['query', 'limit', false], ['query', 'tag', true],
    ]);
    assert.deepEqual(list.parameters[1].schema, { type: 'integer', minimum: 1 });
    const create = doc.paths['/orgs/{org}/users']!.post;
    assert.deepEqual(create.parameters.at(-1), { name: 'x-tenant', in: 'header', required: true, schema: { type: 'string' } });
  });

  it('requestBody e respostas, com vários content types e 204 sem corpo', () => {
    const create = doc.paths['/orgs/{org}/users']!.post;
    assert.deepEqual(create.requestBody, {
      required: true,
      content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
    });
    assert.equal(create.responses['201'].description, 'Created');
    assert.deepEqual(Object.keys(doc.paths['/orgs/{org}/users']!.get.responses['200'].content), ['application/json', 'text/csv']);
    assert.deepEqual(doc.paths['/orgs/{org}/users/{id}']!.delete.responses['204'], { description: 'No Content' });
  });

  it('erros como Problem Details; rota sem schema recebe 200 genérico', () => {
    assert.deepEqual(doc.paths['/health']!.get.responses, {
      200: { description: 'OK' },
      default: { description: 'Error', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } } } },
    });
    assert.deepEqual(doc.components.schemas.ProblemDetails.required, ['type', 'title', 'status']);
  });

  it('com formatError, não promete o formato Problem Details', () => {
    const custom = createApp({ logger: false, formatError: (p) => p }).mount(Health).openapiDocument() as Doc;
    assert.deepEqual(custom.paths['/health']!.get.responses.default, { description: 'Error' });
    assert.equal(custom.components, undefined);
    assert.deepEqual(custom.info, { title: 'API', version: '0.0.0' });
  });

  it('operationId único quando a mesma classe é montada duas vezes', () => {
    const twice = createApp({ logger: false }).mount(Health).mount(Health, { prefix: '/v2/health' }).openapiDocument() as Doc;
    assert.equal(twice.paths['/health']!.get.operationId, 'Health.check');
    assert.equal(twice.paths['/v2/health']!.get.operationId, 'Health.check_2');
  });

  it('toOpenAPIPath', () => {
    assert.equal(toOpenAPIPath('/a/:b(^\\d+)/c'), '/a/{b}/c');
    assert.equal(toOpenAPIPath('/geo/:lat-:lng'), '/geo/{lat}-{lng}');
    assert.equal(toOpenAPIPath('/time/10::30'), '/time/10:30');
    assert.equal(toOpenAPIPath('/files/*'), '/files/{*}');
  });
});

describe('F-16 · /openapi.json e /docs', () => {
  it('serve o documento, gerado depois de todos os mounts', async () => {
    const app = createApp({ logger: false }).openapi({ info: { title: 'X', version: '1' } }).mount(Health);
    app.mount(Users);
    const res = await app.inject('/openapi.json');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.ok(res.json<Doc>().paths['/orgs/{org}/users']);
    assert.equal((await app.inject({ method: 'POST', url: '/openapi.json' })).status, 404);
  });

  it('mount depois da primeira requisição invalida o cache', async () => {
    const app = createApp({ logger: false }).openapi().mount(Health);
    assert.equal(Object.keys((await app.inject('/openapi.json')).json<Doc>().paths).length, 1);
    app.mount(Users);
    assert.equal(Object.keys((await app.inject('/openapi.json')).json<Doc>().paths).length, 3);
  });

  it('/docs serve o Swagger UI com SRI, nonce e CSP própria', async () => {
    const app = createApp({ logger: false }).mount(Health).openapi({ path: '/spec.json', info: { title: '<script>', version: '1' } });
    const res = await app.inject('/docs');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    const csp = String(res.headers['content-security-policy']);
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    assert.ok(nonce);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /connect-src 'self'/);
    assert.ok(res.body.includes(`<script nonce="${nonce}">`));
    assert.match(res.body, /integrity="sha384-[^"]+"/);
    assert.ok(res.body.includes('url: "/spec.json"'));
    assert.ok(res.body.includes('<title>&lt;script&gt;</title>'), 'título escapado');
    const again = await app.inject('/docs');
    assert.notEqual(String(again.headers['content-security-policy']), csp, 'nonce novo a cada resposta');
  });

  it('docs: false desliga a página; middlewares globais protegem as duas rotas', async () => {
    const auth: Middleware = (ctx, next) => { if (ctx.get('authorization') !== 'ok') throw unauthorized(); return next(); };
    const app = createApp({ logger: false }).use(auth).openapi({ docs: false }).mount(Health);
    assert.equal((await app.inject('/openapi.json')).status, 401);
    assert.equal((await app.inject({ url: '/openapi.json', headers: { authorization: 'ok' } })).status, 200);
    assert.equal((await app.inject({ url: '/docs', headers: { authorization: 'ok' } })).status, 404);
  });

  it('openapi() pode ser chamado a partir do retorno de mount()', async () => {
    const app = createApp({ logger: false }).mount(Health).openapi({ docs: '/ref' });
    assert.equal((await app.inject('/ref')).status, 200);
  });
});

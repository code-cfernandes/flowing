# Respostas e o ctx

O valor retornado pelo handler vira a resposta. Sem schema de resposta, o formato vem do tipo do valor:

| Retorno                                 | Resposta                               |
| --------------------------------------- | -------------------------------------- |
| objeto, array, número, booleano, `null` | `application/json`                     |
| `string`                                | `text/plain; charset=utf-8`, sem aspas |
| `Buffer` / `Uint8Array`                 | `application/octet-stream`             |
| `Readable` (stream)                     | enviado em stream                      |
| `undefined`                             | sem corpo                              |

Um `Content-Type` definido no handler (`ctx.header('Content-Type', ...)`) sempre prevalece.

## Outros formatos: `contentType`, serializadores e `Accept`

Uma entrada de `response` pode declarar o tipo de conteúdo. Um schema sem `contentType` continua sendo JSON:

```ts
// CSV cru: o `return` de uma string sai como está
@Get('/export.csv', { response: { 200: { contentType: 'text/csv', schema: Type.String() } } })
exportCsv() { return 'id,name\n1,Ana\n'; }

// Vários formatos: o cliente escolhe pelo Accept (q-values e curingas); sem Accept, vale o primeiro
@Get('/', { response: { 200: { contentType: ['application/json', 'application/yaml'], schema: Type.Array(User) } } })
list() { return users; }
```

Objetos em formatos que não são JSON passam por um **serializador** registrado no app. A biblioteca é escolha sua:

```ts
import YAML from 'yaml';
createApp({ serializers: { 'application/yaml': (data) => YAML.stringify(data) } });
```

- **Campos não declarados nunca saem, em nenhum formato.** Antes do serializador, a saída é validada contra o schema e os campos extras são removidos (sobre uma cópia). Se não bater com o schema, a resposta é 500, com o motivo no log.
- **Sem formato aceitável:** a resposta é `406 Not Acceptable`, com os tipos disponíveis. Rotas com mais de um tipo enviam `Vary: Accept`.
- **Sem serializador:** um objeto num tipo sem serializador registrado gera 500, com a instrução no log.
- **Erros:** continuam em JSON.

## Dois estilos, um pipeline

Dá para responder com `return` ou com envio imperativo (`ctx.json()`, `ctx.send()`, `ctx.text()`). Os dois passam pelo **mesmo** pipeline: schema do status, remoção de campos não declarados, status padrão, negociação e serializadores. A resposta é idêntica.

```ts
const job = {
  body: Type.Object({ async: Type.Boolean() }),
  response: { 200: Type.Object({ result: Type.String() }), 202: Type.Object({ jobId: Type.String() }) },
} satisfies RouteSchemas;

@Post('/jobs', job)
run(ctx: Context<typeof job>) {
  if (ctx.body.async) return ctx.status(202).json({ jobId: enqueue() });  // status decidido em runtime
  return { result: process() };                                           // status padrão
}
```

**O `status()` tipa o corpo.** Com schemas de resposta, `ctx.status()` só aceita os status declarados, e o `json()`/`send()` seguinte exige o corpo daquele status. `ctx.status(202).json({ result })` e `ctx.status(201)` são erros de compilação no exemplo acima.

Estilo recomendado:

- `return` para o caso comum;
- `ctx.status(x).json(body)` quando o status é decidido em runtime;
- `throw` para erros.

Os schemas de resposta valem para o que o **handler** envia. Middlewares e guards que respondem antes dele (manutenção, cache, 401), as respostas de erro e os 404/405 do framework não passam pelo schema da rota.

## Helpers do `ctx`

| Método                              | Uso                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `ctx.status(code)`                  | Define o status                                                                          |
| `ctx.header(name, value)`           | Define um header da resposta                                                             |
| `ctx.get(name)`                     | Lê um header da requisição                                                               |
| `ctx.json(data)`                    | Envia JSON pelo pipeline (schema, filtro, status padrão)                                 |
| `ctx.text(str)`                     | `text/plain; charset=utf-8`, pelo pipeline                                               |
| `ctx.send(body, contentType?)`      | Qualquer corpo pelo pipeline: string, bytes, stream ou objeto (negociado pelo `Accept`)  |
| `ctx.redirect(url, status?)`        | 302 por padrão; aceita 301, 303, 307, 308                                                |
| `ctx.cookies`                       | Cookies da requisição (objeto sem protótipo)                                             |
| `ctx.setCookie(name, value, opts?)` | Adiciona um `Set-Cookie`, com `HttpOnly`, `Secure`, `SameSite=Lax` e `Path=/` por padrão |
| `ctx.clearCookie(name, opts?)`      | Remove um cookie (use o mesmo `path` e `domain` da criação)                              |
| `ctx.throw(status, message)`        | Lança um `HttpError`                                                                     |

Outros campos: `ctx.params`, `ctx.query`, `ctx.body`, `ctx.state`, `ctx.id`, `ctx.log`, `ctx.sentBody`, `ctx.sentType`, `ctx.ip`, `ctx.host`, `ctx.hostname`, `ctx.protocol`, `ctx.method`, `ctx.path`, `ctx.url`, `ctx.signal`, `ctx.abortReason`, `ctx.trace`, `ctx.req` e `ctx.res`.

**`ctx.route`** diz qual rota atende a requisição: `{ method, path: '/v1/users/:id', owner: 'UserRoutes', handler: 'getUser', host?: '*.exemplo.com' }`. O `path` é o template já com os prefixos, nunca o path recebido, e o `host` é a regra de virtual host que venceu: os dois servem como rótulo de métrica sem explodir a cardinalidade. Fica `undefined` antes do roteamento e quando nenhuma rota atende (404, 405, healthcheck, OpenAPI).

> ⚠️ `ctx.send` não faz escape de HTML; escape o conteúdo dinâmico antes. `ctx.redirect` com uma URL vinda do usuário abre um _open redirect_; valide o destino.

# OpenAPI e /docs

```ts
createApp()
  .mount(UserRoutes)
  .openapi({
    info: { title: 'Minha API', version: '1.0.0' },
    servers: [{ url: 'https://api.exemplo.dev' }],
    docs: true, // Swagger UI em /docs (desligado por padrão)
    guards: [isAdmin], // só para /openapi.json e /docs
  });
```

- **Nada é exposto sem `app.openapi()`.** Para só gerar o arquivo, sem rota, use `app.openapiDocument()`.
- **`GET /openapi.json`:** documento OpenAPI 3.1 gerado das rotas registradas. É montado na primeira requisição, então pode chamar `openapi()` antes ou depois dos `mount()`.
- **`GET /docs`:** Swagger UI, **opt-in** com `docs: true` (ou `docs: '/ref'` para outro path). A versão é fixada e carregada do CDN com SRI (o navegador confere o hash do arquivo), e a página tem CSP própria, com `nonce` no script.
- **Acesso:** `middlewares` e `guards` funcionam como no `mount()` e valem só para o documento e a página, no path que estiver configurado. As duas rotas também passam pelos middlewares globais (`app.use()`).
- **Opções:** `path` muda o endereço do documento.
- **`app.openapiDocument()`:** devolve o objeto, para gravar em arquivo, gerar clientes ou testar no CI.
- **O que entra no documento:**

  | Origem                       | Vira                                                                                |
  | ---------------------------- | ----------------------------------------------------------------------------------- |
  | Path (`/:id(^\\d+)`)         | `/{id}`                                                                             |
  | `params`, `query`, `headers` | `parameters`, com `required`                                                        |
  | `body`                       | `requestBody` em JSON                                                               |
  | `response`                   | uma resposta por status, com os `contentType` declarados                            |
  | Erros                        | resposta `default` com o schema `ProblemDetails`; com `formatError`, só a descrição |
  | Classe e método              | `tags` e `operationId` (`UserRoutes.getUser`)                                       |

- **Limites:** só schemas JSON Schema (TypeBox) entram como estão. Rotas sem schema de resposta aparecem com um `200` genérico. Em produção, proteja as rotas com `guards`/`middlewares` ou gere só o arquivo com `openapiDocument()`.

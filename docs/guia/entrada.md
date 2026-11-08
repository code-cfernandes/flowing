# Formatos de entrada

O Flowing lê body JSON por padrão (com `bodyLimit` e proteção contra prototype pollution) e a query string em formato plano. Os dois podem ser estendidos.

## Outros formatos de body

`parsers` registra um parser por tipo de mídia, além do JSON:

```ts
import YAML from 'yaml';

createApp({
  parsers: {
    'application/yaml': (raw) => YAML.parse(raw.toString('utf8')),
    'application/x-www-form-urlencoded': (raw) => Object.fromEntries(new URLSearchParams(raw.toString('utf8'))),
  },
});
```

- O parser recebe o corpo cru (um `Buffer`), já limitado pelo `bodyLimit` (acima dele, 413), e pode ser assíncrono.
- O resultado passa pela mesma proteção contra prototype pollution do JSON (`protoPoisoning`) e é validado pelo contrato da rota, como qualquer body.
- Se o parser lançar, a resposta é 400 `INVALID_BODY`, sem expor a mensagem original.
- Um tipo sem parser não é lido: o corpo continua disponível em `ctx.req`, como para o `multer` (veja [Vindo do Express](./vindo-do-express#middlewares-do-express-upload-com-multer)).
- O JSON é nativo e não pode ser substituído; a chave precisa ser um tipo de mídia. Os dois erros aparecem na criação do app.

::: warning Formulários e CSRF
O navegador envia `application/x-www-form-urlencoded`, `multipart/form-data` e `text/plain` de outro site sem preflight. Se o app aceitar esses tipos em rotas com sessão por cookie, use o `csrf()` (veja [Segurança](./seguranca)).
:::

## Query aninhada

O parser padrão entende queries planas (`?tag=a&tag=b` vira `{ tag: ['a', 'b'] }`). Para sintaxes aninhadas, como `?filter[status]=ativo&sort[]=nome`, troque o parser, por exemplo pelo `qs`, instalado no seu projeto:

```ts
import qs from 'qs';

createApp({
  queryParser: (raw) => qs.parse(raw, { depth: 3, arrayLimit: 50, parameterLimit: 1000 }),
});
```

- O retorno passa por um filtro recursivo que remove `__proto__`, `constructor` e `prototype` em qualquer nível, mesmo que o parser os deixe passar.
- Se o parser lançar (ou não devolver um objeto), a resposta é 400 `INVALID_QUERY`, sem expor a mensagem.
- O `queryMaxKeys` vale só para o parser padrão: com um parser próprio, os limites são dele (`parameterLimit`, `depth`, `arrayLimit` no `qs`).
- O contrato `query` da rota valida o objeto aninhado normalmente.

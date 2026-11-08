# Upload de arquivos

O upload faz parte do contrato da rota. Declare os arquivos em `files` e os campos de texto do formulário em `body`: tudo é recebido e conferido antes do handler, e o handler só roda com um arquivo válido.

```ts
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { type Context, Post, Router, type RouteSchemas, Type } from 'sashiko';

const enviar = {
  body: Type.Object({ membro: Type.String(), ano: Type.Integer() }),
  files: { pdf: { required: true, maxSize: '5mb', types: ['application/pdf'] } },
  response: { 201: Type.Object({ ok: Type.Boolean() }) },
} satisfies RouteSchemas;

@Router('/documentos')
class DocumentoRoutes {
  @Post('/', enviar)
  async enviar(ctx: Context<typeof enviar>) {
    const pdf = ctx.file('pdf'); // com required: true, nunca é undefined
    await pipeline(pdf.stream(), createWriteStream(`/dados/${crypto.randomUUID()}.pdf`));
    return { ok: true }; // ctx.body.ano já é number
  }
}
```

## Regras de cada arquivo

| Regra      | O que faz                                                                             | Padrão          |
| ---------- | ------------------------------------------------------------------------------------- | --------------- |
| `required` | O campo precisa ter um arquivo                                                        | `false`         |
| `maxSize`  | Tamanho máximo de cada arquivo (`'512kb'`, `'5mb'`)                                   | o limite global |
| `maxCount` | Quantos arquivos o campo aceita; use `ctx.files(nome)` quando for mais de um          | `1`             |
| `types`    | Tipos aceitos (`'application/pdf'`, `'image/*'`), conferidos também pelo conteúdo     | qualquer tipo   |
| `verify`   | Conferência própria: recebe os primeiros bytes do arquivo e devolve `true` ou `false` | —               |

Quando uma regra falha, a resposta sai em Problem Details e o handler não roda:

| Situação                                   | Status | `code`                   |
| ------------------------------------------ | ------ | ------------------------ |
| Arquivo maior que o `maxSize`              | 413    | `FILE_TOO_LARGE`         |
| Tipo não aceito ou conteúdo que não bate   | 400    | `INVALID_FILE_TYPE`      |
| Arquivo obrigatório ausente                | 400    | `FILE_REQUIRED`          |
| Mais arquivos que o `maxCount`             | 400    | `TOO_MANY_FILES`         |
| Campo de arquivo não declarado             | 400    | `UNEXPECTED_FILE`        |
| Requisição que não é `multipart/form-data` | 415    | `UNSUPPORTED_MEDIA_TYPE` |

Os campos de texto chegam em `ctx.body` e são validados pelo contrato `body`, com conversão de texto como na query (`'2026'` vira `2026` num `Type.Integer()`). Com `contracts.standard()`, use `z.coerce.number()`.

## O arquivo no handler

`ctx.file(nome)` e `ctx.files(nome)` são síncronos: o arquivo já foi recebido. Cada arquivo traz:

- `filename`: o nome enviado pelo cliente. É só um metadado; **nunca o use como caminho no disco**.
- `mimetype` (o tipo declarado pelo cliente) e `detectedType` (o tipo detectado pelo conteúdo, quando o formato tem assinatura conhecida).
- `size`: o tamanho efetivamente recebido.
- `stream()`: o conteúdo como stream, uma vez só. `buffer()`: o conteúdo inteiro na memória, para arquivos pequenos.

Até o handler, o arquivo fica num temporário com nome gerado, apagado quando a resposta termina: em sucesso, em erro e quando o cliente desiste no meio do envio.

## Conferência do conteúdo

Com `types`, o Sashiko confere o tipo declarado e também os primeiros bytes do arquivo, com a [`magic-bytes.js`](https://github.com/LarsKoelpin/magic-bytes): um executável enviado como `relatorio.pdf` é recusado.

A detecção tem limites:

- **Formatos de texto** (`.csv`, `.json`, `.txt`, SVG) não têm assinatura: só o tipo declarado é conferido.
- **Documentos do Office e do LibreOffice** (`.docx`, `.xlsx`, `.pptx`, `.odt`) são um ZIP por dentro e são conferidos só como ZIP.
- Um binário que o detector não reconhece é recusado, a não ser que a rota tenha `verify`.

Para conferir o tipo exato de um `.docx`, instale o [`file-type`](https://github.com/sindresorhus/file-type) e ligue-o como detector:

```ts
import { fileTypeFromBuffer } from 'file-type';
import { createApp, detectors } from 'sashiko';

const app = createApp({ uploads: { detect: detectors.fileType(fileTypeFromBuffer) } });
```

E para regras próprias, use `verify`, que recebe os primeiros bytes:

```ts
const files = {
  pdf: {
    types: ['application/pdf'],
    // recusa PDFs com JavaScript embutido no começo do arquivo
    verify: (head: Uint8Array) => !Buffer.from(head).includes('/JavaScript'),
  },
};
```

::: tip A libmagic do PHP
Quem conhece o `finfo` do PHP pode usar o [`wasmagic`](https://github.com/moshen/wasmagic), a mesma libmagic compilada para WebAssembly, dentro do `verify` ou como detector próprio (`uploads.detect` recebe os primeiros bytes e devolve a lista de tipos).
:::

## Limites globais

```ts
createApp({
  uploads: {
    limits: { fileSize: '10mb', files: 10, fields: 50, fieldSize: '100kb', parts: 60 }, // os padrões
    tempDir: '/var/tmp/uploads', // padrão: a pasta temporária do sistema
  },
});
```

O contrato de cada rota só pode restringir os limites globais: uma rota com `maxSize` maior que `uploads.limits.fileSize` falha no registro.

## OpenAPI

A rota sai como `multipart/form-data`, com os campos do `body`, os arquivos como `format: binary` (um array quando `maxCount` é maior que 1) e os tipos aceitos no `encoding`.

## Receita: enviar para S3 ou MinIO

O arquivo já vem validado; basta passar o stream para o SDK:

```ts
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const s3 = new S3Client({}); // para o MinIO: { endpoint, forcePathStyle: true }

@Post('/', enviar)
async enviar(ctx: Context<typeof enviar>) {
  const pdf = ctx.file('pdf');
  await new Upload({
    client: s3,
    params: { Bucket: 'documentos', Key: `${crypto.randomUUID()}.pdf`, Body: pdf.stream(), ContentType: 'application/pdf' },
  }).done();
  return { ok: true };
}
```

## Segurança

- **CSRF:** o navegador envia `multipart/form-data` de outro site sem preflight. Em rotas com sessão por cookie, use o middleware `csrf()`.
- **Nome do arquivo:** o temporário tem nome gerado, e o caminho enviado pelo cliente é descartado. Ao salvar, gere o nome você também.
- **Rotas sem `files`** não leem o multipart: o corpo fica intacto em `ctx.req`, e o `multer` continua funcionando como antes (veja [Vindo do Express](./vindo-do-express)).

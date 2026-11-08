---

## aprenda: Receber arquivos pelo contrato da rota, com limites, tipos conferidos pelo conteúdo e limpeza automática.

# Upload de arquivos

O upload faz parte do contrato da rota. Declare os arquivos em `files` e os campos de texto do formulário em `body`: tudo é recebido e conferido antes do handler, e o handler só roda com um arquivo válido.

```ts
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { type Context, Post, Router, type RouteSchemas, Type } from 'flowingts';

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

Os campos de texto chegam em `ctx.body` e são validados pelo contrato `body`:

- **Tudo chega como texto.** No motor nativo, o contrato converte como na query: `'2026'` vira `2026` num `Type.Integer()` e `'true'` vira `true` num `Type.Boolean()`. Um valor que não converte é recusado com 400. Com `contracts.standard()`, a conversão é do próprio schema: use `z.coerce.number()`.
- **Campo repetido vira array:** `tag=a&tag=b` chega como `['a', 'b']`. Declare `Type.Array(Type.String())`; um `Type.String()` recusa o envio repetido com 400.
- **Nomes com colchetes ficam literais:** `usuario[nome]` é a chave `'usuario[nome]'`, sem virar objeto aninhado.

## O arquivo no handler

`ctx.file(nome)` e `ctx.files(nome)` são síncronos: o arquivo já foi recebido. Cada arquivo traz:

- `filename`: o nome enviado pelo cliente. É só um metadado; **nunca o use como caminho no disco**.
- `mimetype` (o tipo declarado pelo cliente) e `detectedType` (o tipo detectado pelo conteúdo, quando o formato tem assinatura conhecida).
- `size`: o tamanho efetivamente recebido.
- `stream()`: o conteúdo como stream, uma vez só. `buffer()`: o conteúdo inteiro na memória, para arquivos pequenos.

Até o handler, o arquivo fica num temporário com nome gerado, apagado quando a resposta termina: em sucesso, em erro do contrato ou do handler e quando o cliente desiste no meio do envio.

::: warning O arquivo vive até a resposta
Termine de ler o `stream()` (salvar no disco, enviar para o S3) **antes** de o handler retornar, com `await`. Não guarde o arquivo para ler depois, numa fila ou num `setTimeout`: o temporário é apagado assim que a resposta sai. Para processar depois, copie-o primeiro para um lugar seu.
:::

## Conferência do conteúdo

Com `types`, o FlowingTS confere o tipo declarado e também os primeiros bytes do arquivo, com a [`magic-bytes.js`](https://github.com/LarsKoelpin/magic-bytes): um executável enviado como `relatorio.pdf` é recusado. A conferência lê uma cópia do começo do arquivo; o `stream()` entregue ao handler começa do primeiro byte.

O que cada camada garante:

| Conferência                    | O que garante                                         | Quem faz                                      |
| ------------------------------ | ----------------------------------------------------- | --------------------------------------------- |
| Tipo declarado (`mimetype`)    | O que o cliente afirma enviar                         | `types`                                       |
| Assinatura dos primeiros bytes | Que o formato provavelmente é o declarado             | `types` (`magic-bytes.js`)                    |
| Estrutura interna              | Que o arquivo abre e é íntegro (um PDF que renderiza) | a aplicação, com `verify` ou depois do upload |
| Antivírus ou sandbox           | Que o conteúdo não é malicioso                        | a aplicação (ClamAV, um serviço externo)      |

`types` é uma conferência de **formato**, não uma análise de segurança: um PDF verdadeiro pode carregar conteúdo malicioso.

A detecção tem limites:

- **Formatos de texto** (`.csv`, `.json`, `.txt`, SVG) não têm assinatura: só o tipo declarado é conferido.
- **Documentos do Office e do LibreOffice** (`.docx`, `.xlsx`, `.pptx`, `.odt`) são um ZIP por dentro e são conferidos só como ZIP.
- Um binário que o detector não reconhece é recusado, a não ser que a rota tenha `verify`.

Para conferir o tipo exato de um `.docx`, instale o [`file-type`](https://github.com/sindresorhus/file-type) e ligue-o como detector:

```ts
import { fileTypeFromBuffer } from 'file-type';
import { createApp, detectors } from 'flowingts';

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
- **Corpo recusado:** quando um arquivo é recusado no meio do envio, o FlowingTS lê e descarta o resto do corpo, sem guardá-lo, até 1 MB ou 2 segundos, para o cliente receber o 400 ou o 413. Acima disso, responde e fecha a conexão.
- **Rotas sem `files`** não leem o multipart: o corpo fica intacto em `ctx.req`, e o `multer` continua funcionando como antes (veja [Vindo do Express](./vindo-do-express)).

# Logs e request id

```ts
import pino from 'pino';

createApp({ logger: pino(), logRequests: true });
```

- **Logger:** compatível com o pino (`info(obj, msg)`, `child()`). O padrão, `consoleLogger({ level, format, redact, stream })`, usa o `console`: `format: 'json'` gera uma linha JSON por evento, para coletores de log. `logger: false` desliga tudo.
- **Níveis:** `trace`, `debug`, `info`, `warn`, `error` e `fatal`, os mesmos do pino. `trace` e `fatal` são opcionais na interface `Logger`, para um logger próprio não precisar implementá-los: use `ctx.log.trace?.(...)`.
- **`stream: 'stdout'`:** manda todos os níveis para a saída padrão. Por padrão, `warn`, `error` e `fatal` vão para o stderr, que alguns coletores tratam inteiro como erro.
- **Request id:** cada requisição recebe `ctx.id`, também devolvido no header `X-Request-Id`. Um id recebido nesse header é reaproveitado se for seguro; isso é configurável em `requestId`.

  O padrão gera um UUID (`crypto.randomUUID()`), que não é previsível e não revela quantas requisições o processo atendeu. Se a alocação por requisição importar mais que isso, troque o gerador:

  ```ts
  import { randomUUID } from 'node:crypto';

  const prefix = randomUUID().slice(0, 8); // único por processo
  let seq = 0;
  createApp({ requestId: { generate: () => `${prefix}-${(++seq).toString(36)}` } });
  ```

  Num benchmark de `GET` simples, isso reduziu a alocação por requisição em cerca de 8%, sem diferença mensurável de vazão ou memória. `requestId: { header: false }` deixa de enviar o header; `ctx.id` e o `reqId` dos logs continuam.

- **`ctx.log`:** já inclui o `reqId`, e o `traceId` quando a requisição chega com `traceparent` (ou o `traceId` e o `spanId` do span, com `telemetry`): `ctx.log.info({ userId }, 'user created')`.
- **Trace recebido:** um `traceparent` W3C válido é exposto em `ctx.trace` (`{ traceId, parentSpanId, sampled, tracestate }`). Sem `X-Request-Id` recebido, o `ctx.id` passa a ser o `traceId`, e logs e traces ficam com a mesma chave. O header é validado pela especificação; um valor inválido é ignorado.
- **`logRequests: true`:** registra método, path, status e duração de cada requisição.
- **Dados sensíveis:** headers e body nunca são logados automaticamente. O que você logar passa pelo `redact` do logger padrão. As chaves `authorization`, `cookie`, `set-cookie`, `x-api-key`, `password`, `secret`, `token`, `access_token`, `refresh_token` e afins, em qualquer nível, saem como `[REDACTED]`. A comparação ignora maiúsculas, `-` e `_`.

  ```ts
  createApp({ logger: consoleLogger({ redact: ['cpf', 'cardNumber'] }) }); // soma às chaves padrão; false desliga
  ```

  Com o pino, configure o [`redact`](https://getpino.io/#/docs/redaction) dele.

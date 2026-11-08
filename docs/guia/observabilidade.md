# Observabilidade

Passe o `@opentelemetry/api` que a aplicação já usa. O Flowing não depende do pacote nem prende uma versão:

```ts
import * as otel from '@opentelemetry/api';

createApp({ telemetry: otel });
```

- **Com a auto-instrumentação HTTP do SDK** (o caso mais comum): o Flowing enriquece o span SERVER que ela criou, com o nome `GET /users/:id`, o `http.route` e as exceções com a fase (`middleware`, `guard`, `validation`, `handler`, `response`). Não cria span duplicado.
- **Sem a auto-instrumentação:** o Flowing cria o span SERVER, continuando o `traceparent` recebido, e roda o handler dentro dele, então os spans criados pela aplicação viram filhos. Só um 5xx marca o span como erro.
- **Métricas**, pelo `metrics.getMeter('flowingts')`, com os nomes das convenções semânticas HTTP:

  | Métrica                        | Tipo                        | Atributos                                                                                        |
  | ------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------ |
  | `http.server.request.duration` | histograma (s), sem streams | `http.request.method`, `http.route`, `http.response.status_code`, `server.address`, `error.type` |
  | `flowing.stream.duration`      | histograma (s), só streams  | os mesmos                                                                                        |
  | `http.server.active_requests`  | up-down counter             | `http.request.method`                                                                            |
  | `flowing.request.aborted`      | counter                     | `flowing.abort.reason`                                                                           |

  O `http.route` vem sempre do template e o `server.address` da regra de virtual host, nunca do path ou do hostname do cliente: a cardinalidade das séries fica fixa. Nenhum atributo inclui query, headers ou body.
- **Sem `telemetry`**, os mesmos dados estão disponíveis para outra ferramenta em `ctx.route`, `ctx.trace`, `onRequest` e `onResponse`.

**Custo** (benchmark de `GET` simples, SDK real com um exportador que descarta os spans): a auto-instrumentação HTTP do OpenTelemetry é a parte cara, também num `node:http` puro. Em cima dela, o `telemetry` reduziu a vazão em cerca de 6% (de ~41 mil para ~38,5 mil req/s) e aumentou o RSS de pico em 5 a 9 MB (de ~243 para 247 a 252 MB). Sem `telemetry` e sem hooks, nada disso é carregado.

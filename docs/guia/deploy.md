# Deploy em produção

```ts
const app = createApp({
  logger: consoleLogger({ format: 'json' }), // uma linha JSON por evento, com redact
  trustProxy: 1, // atrás de 1 proxy/load balancer
  allowedHosts: ['api.exemplo.com'],
  securityHeaders: { strictTransportSecurity: true }, // HSTS: só com HTTPS na frente
  shutdown: { drainDelayMs: 5_000, timeoutMs: 10_000 },
})
  .use(rateLimit({ max: 100, windowMs: 60_000 }))
  .mount(UserRoutes)
  .health({ checks: { db: () => db.ping() } });

await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
```

Checklist:

| Item                             | Como                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Escutar fora do container        | `host: '0.0.0.0'` (o padrão é `127.0.0.1`), porta por `PORT`                                                                        |
| TLS                              | No proxy ou load balancer (recomendado), ou `listen({ tls })`                                                                       |
| Proxy à frente                   | `trustProxy` com o número **exato** de proxies; nunca `true` se o app for acessível direto                                          |
| Domínios                         | `allowedHosts` com os domínios servidos                                                                                             |
| HSTS                             | `securityHeaders: { strictTransportSecurity: true }`, só quando todo acesso for HTTPS                                               |
| Logs                             | `consoleLogger({ format: 'json' })` ou pino; campos sensíveis já mascarados                                                         |
| Healthchecks                     | `/livez` (liveness) e `/readyz` (readiness) com `app.health()`                                                                      |
| Encerramento                     | SIGTERM já tratado; `drainDelayMs` maior que o intervalo da sonda de readiness                                                      |
| Rate limit com várias instâncias | `RateLimitStore` compartilhado (Redis), porque o padrão é em memória por processo                                                   |
| Autenticação por cookie          | `csrf()` ativo                                                                                                                      |
| Documentação da API              | `openapi({ guards })`, ou gerar só o arquivo com `openapiDocument()`                                                                |
| Processo                         | Rode `node dist/server.js` direto (não via `npm start`), para o SIGTERM chegar ao Node; em container, `--init` ou `tini` como PID 1 |
| Memória em contêiner pequeno     | `--max-semi-space-size=8` quando o app serve muitos arquivos e o limite de memória é apertado (veja abaixo)                         |

## Memória ao servir arquivos

Com muitos downloads simultâneos pelo `app.static()` ou pelo `ctx.sendFile()`, a memória do processo (RSS) sobe até um teto e fica nele. Não é vazamento: o que ocupa esse espaço é lixo esperando a coleta, e o teto não cresce com o tempo.

O teto vem de uma troca que o motor do Node (V8) faz sozinho. Quando o app está sob carga, ele aumenta a área de objetos novos do heap para coletar lixo com menos frequência. Isso rende mais requisições por segundo, e em troca os buffers dos arquivos já enviados ficam mais tempo na memória.

Num contêiner com limite de memória apertado, dá para inverter a troca com uma flag do Node, que limita essa área (o valor é em MiB):

```bash
node --max-semi-space-size=8 dist/server.js
# ou, sem mudar o comando:
NODE_OPTIONS=--max-semi-space-size=8 node dist/server.js
```

Medição com um arquivo de 64 KB, 200 conexões simultâneas e Node 26, média de três rodadas:

| Configuração                      | Pico de memória (RSS) | Requisições por segundo |
| --------------------------------- | --------------------- | ----------------------- |
| Padrão do Node                    | 219 MB                | 4.080                   |
| `--max-semi-space-size=8`         | 137 MB                | 3.830                   |
| `--max-semi-space-size=4`         | 122 MB                | 3.820                   |
| `node:http` puro, para comparação | 175 MB                | 4.260                   |

A flag corta cerca de 80 MB e custa perto de 6% da vazão. Sem limite de memória apertado, deixe o padrão: a memória a mais está comprando desempenho. Os números mudam com o tamanho dos arquivos, a concorrência e a versão do Node; meça no seu ambiente antes de fixar um valor.

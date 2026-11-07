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

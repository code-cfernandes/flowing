# Ciclo de vida, testes e HTTPS

```ts
const app = createApp().mount(UserRoutes);

await app.listen({ port: 3000, host: '0.0.0.0' }); // resolve quando está ouvindo; SIGINT/SIGTERM já tratados

await app.listen({ port: 443, host: '0.0.0.0', tls: { key, cert } }); // HTTPS, com o mesmo ciclo de vida

// Servidor próprio (http2 em modo compat, outro transporte…): aqui o ciclo de vida é seu
https.createServer(tlsOptions, app.callback()).listen(443);
```

## HTTPS

```ts
import { readFileSync } from 'node:fs';

await app.listen({
  port: 443,
  host: '0.0.0.0',
  tls: {
    key: readFileSync('/etc/ssl/privkey.pem'),
    cert: readFileSync('/etc/ssl/fullchain.pem'),
    // pfx + passphrase também funcionam; minVersion: 'TLSv1.3' para exigir TLS 1.3
  },
});
```

- **Mesmo ciclo de vida do HTTP:** timeouts contra Slowloris, encerramento gracioso nos sinais, `close()` e `onClose`. `ctx.protocol` vira `https`, e os cookies `Secure` funcionam.
- **TLS 1.2 é o mínimo.** SSLv3, TLS 1.0 e 1.1 não são aceitos, nem por configuração.
- **Certificados inválidos falham no `listen()`,** e não no primeiro cliente.
- **Vários domínios (SNI):** cada domínio recebe o seu certificado no handshake.

  ```ts
  tls: {
    key, cert,                                         // principal: domínios sem entrada própria
    sni: {
      'api.exemplo.com': { key: apiKey, cert: apiCert },
      '*.exemplo.dev':   { key: devKey, cert: devCert }, // um nível: a.exemplo.dev, não a.b.exemplo.dev
    },
  }
  ```

  Sem certificado principal, um domínio fora da lista não completa o handshake. Para recusar o domínio também na camada HTTP, combine com `allowedHosts`.
- **Renovação sem reiniciar:** `app.reloadTLS({ key, cert, sni })` troca os certificados, inclusive adicionando `sni` a um servidor que subiu sem ele. As conexões novas usam os novos, e as abertas continuam com os antigos. Um certificado inválido lança erro e mantém os atuais. É o ponto de integração para um cliente ACME externo, como Let's Encrypt via certbot:

  ```ts
  watch('/etc/ssl/fullchain.pem', () => app.reloadTLS({ key: readFileSync(keyPath), cert: readFileSync(certPath) }));
  ```

**TLS no app ou no proxy?** Na maioria dos deploys, o TLS termina no proxy ou no load balancer (Caddy, Nginx, Traefik). Nesse caso, use `app.listen()` em HTTP na rede interna, com `trustProxy: 1` e `allowedHosts`. Use `listen({ tls })` quando não houver proxy à frente ou quando o TLS precisar ir até o processo.

**Fora do core, por decisão:** emissão e renovação automática de certificados (ACME) e gerenciamento de DNS. São responsabilidades de ferramentas próprias, integradas pelo `reloadTLS()`.

### Planos futuros

- **HTTP/2** (com fallback para HTTP/1.1 via ALPN). Ainda não é suportado pelo `listen()`. O modo de compatibilidade do Node muda partes do ciclo de vida: o shutdown usa GOAWAY, e não `Connection: close`; não existem `requestTimeout` nem `headersTimeout`; os limites de streams precisam de padrão seguro. Por isso, entra numa versão própria. Até lá, o proxy à frente pode falar HTTP/2 com o cliente e HTTP/1.1 com o app.
- **mTLS:** certificado do cliente (`requestCert`) e `ctx.clientCertificate`.

## Encerramento gracioso

**Encerramento gracioso, sem código.** Com `listen()`, um SIGINT ou SIGTERM faz o app parar de aceitar conexões, esperar as requisições em andamento (com prazo) e sair com código 0:

```ts
createApp({
  shutdown: {
    timeoutMs: 10_000, // prazo para as requisições em andamento (padrão)
    onShutdown: async () => {
      await db.close();
    }, // depois que o servidor fecha
  },
});
```

- **Segundo sinal:** força a saída com código 1 (o Ctrl+C duplo). Um erro no `onShutdown` também sai com 1.
- **Vários apps no mesmo processo:** compartilham um único listener por sinal e fecham todos juntos.
- **Limpeza:** os listeners são removidos no `close()`, então testes com vários `listen(0)` não acumulam listeners. O `inject()` e o `callback()` não registram nada.
- **Opções:** `signals` muda os sinais tratados, `exit: false` fecha sem chamar `process.exit`, e `shutdown: false` desliga tudo (por exemplo, se outra ferramenta controla o processo).
- **Drain para load balancers:** com `shutdown: { drainDelayMs: 5000 }`, o app espera esse tempo antes de parar de aceitar conexões, já com o `/readyz` em 503, para o balanceador tirar a instância de rotação sem cortar requisições.

## Healthchecks

```ts
app.health({
  checks: {
    db: () => db.query('select 1'), // lançar ou devolver false = falha
    cache: () => redis.ping(),
  },
  timeoutMs: 2000, // por check (padrão)
});
```

| Rota          | Responde                                                                                             | Uso                                           |
| ------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `GET /livez`  | 200 `{ "status": "ok" }` enquanto o processo estiver de pé                                           | liveness: reiniciar o processo travado        |
| `GET /readyz` | 200 com o resultado de cada check; 503 se algum falhar ou estourar o tempo, e durante o encerramento | readiness: tirar a instância do balanceamento |

- **Os checks rodam em paralelo.** O motivo da falha vai só para o log, nunca para a resposta, porque pode conter host, usuário ou URL do banco.
- **As rotas são servidas antes dos middlewares globais,** já que sondas não têm credenciais nem devem consumir rate limit. Para restringir, use `guards`/`middlewares` no próprio `health()`.
- **Qualquer host válido:** sondas de orquestradores chegam com o IP do pod no `Host` (Kubernetes, ECS), então o `/livez` e o `/readyz` respondem mesmo fora do `allowedHosts`. Um `Host` malformado continua recebendo 400, e as demais rotas seguem a lista normalmente. `health({ anyHost: false })` volta ao comportamento estrito. O `anyHost` não é autenticação: se o `/readyz` não deve ser público (os checks revelam o nome das dependências), restrinja com `guards` no próprio `health()` ou na rede.
- **Paths reservados:** um path do `health()` ou do `openapi()` que coincida com uma rota GET sua gera erro no registro, em qualquer ordem, porque a rota nunca seria alcançada. A barra final é tratada como nas rotas normais (`/readyz/` responde). `health()` e `openapi()` configuram o app inteiro, então não podem ser chamados dentro do callback de um `group()`.
- **Opções:** `live: '/health'` muda o path, e `ready: false` desliga a rota.

**Testes sem rede.** `app.inject()` executa a requisição em memória:

```ts
const res = await app.inject({ method: 'POST', url: '/users', body: { name: 'Ana' } });
assert.equal(res.status, 201);
assert.equal(res.json<{ name: string }>().name, 'Ana');
```

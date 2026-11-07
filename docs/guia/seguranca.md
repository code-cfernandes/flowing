# Segurança

Ligado por padrão:

| Proteção             | Detalhe                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headers de segurança | `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin`. HSTS é opt-in. Para servir páginas, use `securityHeaders: 'web'` (CSP `default-src 'self'`, `X-Frame-Options: SAMEORIGIN`). |
| Limite de body       | 1 MiB (`bodyLimit`). Recusado já pelo `Content-Length`, com a conexão fechada.                                                                                                                                                                                                                                                              |
| Timeouts             | `requestTimeout` 30s, `headersTimeout` 10s, `keepAliveTimeout` 5s (contra Slowloris).                                                                                                                                                                                                                                                       |
| Query                | Até 1000 pares (`queryMaxKeys`); `__proto__`, `constructor` e `prototype` são descartados.                                                                                                                                                                                                                                                  |
| Body JSON            | `__proto__` e `constructor.prototype` em qualquer nível, inclusive com escapes `\u`, recebem 400 (`PROTO_POISONING`). Com `protoPoisoning: 'remove'`, as chaves são descartadas e a requisição segue.                                                                                                                                       |
| Logs                 | `authorization`, `cookie`, `password`, `token`, `apiKey` e afins saem como `[REDACTED]` no logger padrão.                                                                                                                                                                                                                                   |
| Erros 5xx            | Sem detalhes para o cliente.                                                                                                                                                                                                                                                                                                                |
| Request id           | Ids recebidos só são aceitos se forem seguros (contra log injection).                                                                                                                                                                                                                                                                       |
| Host e path          | `Host` malformado → 400. O path vem do request-target com base fixa: `//evil.com/x` continua sendo esse path e não muda o host. `ctx.url` usa o host validado.                                                                                                                                                                              |

Opt-in:

```ts
import { cors, createApp, csrf, rateLimit } from 'sashiko';

createApp({
  requireSchemas: true,
  securityHeaders: { strictTransportSecurity: true }, // só atrás de HTTPS
})
  .use(cors({ origin: ['https://app.exemplo.com', 'https://*.exemplo.dev'], credentials: true }))
  .use(rateLimit({ max: 100, windowMs: 60_000 })); // 429 + Retry-After
```

- **`cors()`:** a origem é obrigatória, sem default permissivo. Responde ao preflight com 204 e envia `Vary: Origin`. Combinar `origin: '*'` com `credentials: true` gera erro.
- **Regras de origem e de host, seguras por padrão** (as mesmas para `cors()` e `allowedHosts`):

  | Regra                       | Casa com                                                                     | Não casa com                                            |
  | --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------- |
  | `'https://app.exemplo.com'` | a mesma origem, depois de normalizar (maiúsculas, porta padrão, barra final) | `http://…`, outra porta, `app.exemplo.com.atacante.com` |
  | `'https://*.exemplo.dev'`   | qualquer subdomínio                                                          | `exemplo.dev` em si, `exemplo.dev.atacante.com`         |
  | RegExp                      | a string **inteira**, como se tivesse `^…$`                                  | qualquer casamento parcial                              |
  | função                      | o que ela decidir, sob sua responsabilidade                                  | —                                                       |
  - **RegExp sem âncora não vira brecha:** `/app\.exemplo\.com/` não aceita `app.exemplo.com.atacante.com`. As flags `g`, `y` e `m` são descartadas, então o resultado não muda entre requisições.
  - **Prefira o curinga à RegExp:** uma regex mal escrita pode ser lenta com uma entrada maliciosa (ReDoS).
  - **Regras inválidas falham na inicialização,** por exemplo uma origem sem esquema (`'app.exemplo.com'`).
- **Autenticação: `bearerAuth()` e `basicAuth()`.** São guards prontos. A verificação é sua: JWT com a biblioteca que preferir, sessão no banco, lista de chaves. O usuário devolvido vai para `ctx.state.user`.

  ```ts
  const auth = bearerAuth({ verify: async (token) => (await sessions.find(token)) ?? false });
  app.group({ guards: [auth] }, (g) => g.mount(UserRoutes));

  const painel = basicAuth({ verify: (user, pass) => safeEqual(user, 'admin') && safeEqual(pass, process.env.ADMIN_PASS!) });
  ```

  Credencial ausente, malformada ou recusada recebe **o mesmo** 401, com `WWW-Authenticate` e sem dizer o motivo. Para comparar segredos, use `safeEqual()`, que tem tempo constante e também não revela o tamanho. Use o `basicAuth` só sobre HTTPS.
- **`rateLimit()`:** guarda os contadores em memória por padrão. Para várias instâncias, implemente `RateLimitStore` (Redis etc.).
- **Cookies:** `ctx.setCookie()` usa `HttpOnly`, `Secure`, `SameSite=Lax` e `Path=/` por padrão (os navegadores aceitam `Secure` em `http://localhost`). Nome, `path` e `domain` são validados contra injeção de atributos, e os prefixos `__Host-` e `__Secure-` têm as regras conferidas.
- **`csrf()`: ative sempre que a autenticação usar cookies.** Métodos que alteram estado (todos menos GET, HEAD e OPTIONS) vindos de outra origem recebem 403. A checagem usa o `Sec-Fetch-Site` e, na falta dele, compara o `Origin` com a própria origem. Requisições sem esses headers (curl, servidor a servidor) passam, porque não há navegador para anexar os cookies da vítima.

  ```ts
  app.use(csrf());                                              // checagem de origem
  app.use(csrf({ trustedOrigins: ['https://app.exemplo.com'] })); // front em outra origem
  app.use(csrf({ token: true }));                               // + double-submit token
  ```

  Com `token: true`, o middleware cria o cookie `__Host-csrf` (legível pelo JS, `SameSite=Strict`) e o expõe em `ctx.state.csrfToken`; o cliente o devolve no header `X-CSRF-Token`. Rotas GET nunca devem alterar estado.
- **Atrás de proxy:** `ctx.ip`, `ctx.host` e `ctx.protocol` usam o socket e o `Host` por padrão. Com `trustProxy: 1` (o número de proxies à frente do app) ou `true` (toda a cadeia), passam a usar o `X-Forwarded-For`, o `-Host` e o `-Proto`. Só ligue isso atrás de um proxy que reescreve esses headers, porque o cliente pode forjá-los.
- **`allowedHosts`:** com `allowedHosts: ['api.exemplo.com', '*.exemplo.dev']`, qualquer outro `Host` recebe 400. Protege contra host header injection e DNS rebinding. Um host sem porta aceita qualquer porta; com porta (`'api.exemplo.com:8443'`), exige a porta exata.
- **Links absolutos** (reset de senha, redirects): prefira uma URL base da configuração em vez do host pedido pelo cliente.

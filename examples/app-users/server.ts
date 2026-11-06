import { consoleLogger, cors, createApp, rateLimit } from "sashiko";
import { AdminRoutes, HealthRoutes } from "./src/routes/admin.ts";
import { apiKeyGuard } from "./src/guards/api-key.ts";
import { UserRoutes } from "./src/routes/users.ts";
import { csvSerializer } from "./src/serializers/csv.ts";
import { UserRepository } from "./src/store/users.ts";

const PORT = Number(process.env.PORT ?? 3000);
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',');

// Dependências compartilhadas, montadas uma vez (injeção manual; um container fica para F-03)
const users = new UserRepository();
const userRoutes = new UserRoutes(users);

const app = createApp({
  bodyLimit: 64 * 1024,
  // Toda rota precisa de schema de resposta (e de body em POST/PUT/PATCH); falha na inicialização (S-07)
  requireSchemas: true,
  // Headers de segurança já vêm ligados (S-04); aqui só ajustamos. HSTS apenas atrás de HTTPS.
  securityHeaders: { strictTransportSecurity: process.env.NODE_ENV === 'production' },
  // Timeouts contra Slowloris e conexões penduradas (S-06)
  timeouts: { requestTimeout: 15_000, headersTimeout: 5_000 },
  // Logger compatível com pino (F-06): troque por `pino()` em produção. Cada resposta leva X-Request-Id.
  logger: consoleLogger({ level: process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info' }),
  logRequests: true,
  // Formatos além do JSON (F-31): GET /users com Accept: text/csv responde em CSV
  serializers: { 'text/csv': csvSerializer },
  // Encerramento gracioso nos sinais do processo (ligado por padrão); aqui só ajustamos o prazo
  shutdown: { timeoutMs: 5_000, onShutdown: (signal) => app.log.info({ signal, users: users.count() }, 'bye') },
});

app
  // CORS só para as origens conhecidas, com cookies/credenciais (S-01)
  .use(cors({ origin: ALLOWED_ORIGINS, credentials: true, exposedHeaders: ['RateLimit-Remaining'] }))
  // 100 req/min por IP (S-06)
  .use(rateLimit({ max: Number(process.env.RATE_LIMIT ?? 100), windowMs: 60_000 }))
  .onError((err, ctx) => {
    // Ponto para enviar a um APM; se este handler falhar, o app não cai (B-08)
    if (process.env.DEBUG_ERRORS) ctx.log.warn({ err }, 'onError hook');
  })
  // app.mount() é a única porta de entrada (F-28):
  // - classe sem dependências vai direto; com dependências, passe a instância (B-10)
  // - prefix, only/except, middlewares e guards são decididos aqui, sem tocar nas classes
  .mount(HealthRoutes)
  .mount(new AdminRoutes(users), { guards: [apiKeyGuard] })          // toda a área /admin exige a API key
  .mount(userRoutes)
  // Mapeamento manual (F-30): paths que a classe não declara, relativos ao prefixo do grupo
  .get('/export.csv', (r) => r.exportCsv, { guards: [apiKeyGuard] }) // exige a API key só aqui
  .get('/by-id/:id', (r) => r.getUser)                                // alias legado de GET /users/:id
  .mount(userRoutes, { prefix: '/public/users', only: (r) => [r.listUsers, r.getUser] }); // vitrine só leitura, mesma instância

// SIGINT/SIGTERM já são tratados: o app espera as requisições em andamento e fecha (F-07)
await app.listen({ port: PORT });

app.log.info({ port: PORT }, 'Sashiko running');

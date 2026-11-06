import { cors, createApp, rateLimit } from "picodecor";
import { AdminController, HealthController } from "./src/controller/Admin.ts";
import { UserController } from "./src/controller/User.ts";
import { UserRepository } from "./src/store/users.ts";

const PORT = Number(process.env.PORT ?? 3000);
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',');

// Dependências compartilhadas, montadas uma vez (injeção manual; um container fica para F-03)
const users = new UserRepository();

const app = createApp({
  bodyLimit: 64 * 1024,
  // Toda rota precisa de schema de resposta (e de body em POST/PUT/PATCH); falha na inicialização (S-07)
  requireSchemas: true,
  // Headers de segurança já vêm ligados (S-04); aqui só ajustamos. HSTS apenas atrás de HTTPS.
  securityHeaders: { strictTransportSecurity: process.env.NODE_ENV === 'production' },
  // Timeouts contra Slowloris e conexões penduradas (S-06)
  timeouts: { requestTimeout: 15_000, headersTimeout: 5_000 },
});

app
  // CORS só para as origens conhecidas, com cookies/credenciais (S-01)
  .use(cors({ origin: ALLOWED_ORIGINS, credentials: true, exposedHeaders: ['RateLimit-Remaining'] }))
  // 100 req/min por IP (S-06)
  .use(rateLimit({ max: Number(process.env.RATE_LIMIT ?? 100), windowMs: 60_000 }))
  .onError((err, ctx) => {
    // Ponto para enviar a um APM; se este handler falhar, o app não cai (B-08)
    if (process.env.DEBUG_ERRORS) console.warn(`[onError] ${ctx.method} ${ctx.path}`, err);
  })
  // Classe sem dependências pode ir direto; com dependências, passe a instância (B-10)
  .controllers([HealthController, new AdminController(users), new UserController(users)]);

const server = app.listen(PORT);

// ---------- Graceful shutdown ----------
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

console.log(`PicoDecor running at http://127.0.0.1:${PORT}`);

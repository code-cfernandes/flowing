import { createApp } from "picodecor";
import { UserController } from "./src/controller/User.ts";

const app = createApp({ bodyLimit: 64 * 1024 });
app.controllers([UserController]);

const server = app.listen(3000);

// ---------- Graceful shutdown ----------
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

console.log('PicoDecor running at http://127.0.0.1:3000');
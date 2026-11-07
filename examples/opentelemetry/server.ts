import { shutdownTelemetry } from './telemetry.ts'; // primeiro: instala o SDK e a instrumentação HTTP
import { buildApp } from './app.ts';

const app = buildApp();
app.onClose(shutdownTelemetry);
await app.listen({ port: Number(process.env.PORT ?? 3000) });
console.log(`curl http://localhost:${process.env.PORT ?? 3000}/orders/42 · traces em http://localhost:16686`);

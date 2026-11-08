import { buildApp } from './app.ts';

const app = buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3000) });
console.log(`http://localhost:${process.env.PORT ?? 3000}/docs`);

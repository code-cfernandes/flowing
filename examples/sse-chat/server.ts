import { buildApp } from './app.ts';
import { ChatHub } from './hub.ts';

const app = buildApp(new ChatHub());
await app.listen({ port: Number(process.env.PORT ?? 3000) });
console.log(`curl -N http://localhost:${process.env.PORT ?? 3000}/chat/events`);

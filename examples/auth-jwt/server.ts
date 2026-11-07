import { buildApp } from './app.ts';
import { UserStore } from './users.ts';

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) throw new Error('Defina JWT_SECRET com pelo menos 32 caracteres.');

const users = new UserStore();
users.add({ id: '1', email: 'ana@exemplo.com', role: 'admin' }, 'senha-da-ana');
users.add({ id: '2', email: 'bia@exemplo.com', role: 'user' }, 'senha-da-bia');

const app = buildApp(users, secret);
await app.listen({ port: Number(process.env.PORT ?? 3000) });
console.log(`POST http://localhost:${process.env.PORT ?? 3000}/auth/login`);

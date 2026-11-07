import { buildApp } from './app.ts';
import { TaskRepository } from './db.ts';

const app = buildApp(new TaskRepository(process.env.DB_FILE ?? 'tasks.db'));
await app.listen({ port: Number(process.env.PORT ?? 3000) });
console.log(`http://localhost:${process.env.PORT ?? 3000}/tasks`);

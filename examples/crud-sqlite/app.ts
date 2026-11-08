import { type Context, createApp, Delete, Get, notFound, Patch, Post, Router, type RouteSchemas, Type } from 'flowingts';
import type { TaskRepository } from './db.ts';

const Task = Type.Object({ id: Type.Integer(), title: Type.String(), done: Type.Boolean() });
const Id = Type.Object({ id: Type.Integer({ minimum: 1 }) });

const list = {
  query: Type.Object({ done: Type.Optional(Type.Boolean()) }),
  response: { 200: Type.Array(Task) },
} satisfies RouteSchemas;
const getOne = { params: Id, response: { 200: Task } } satisfies RouteSchemas;
const create = {
  body: Type.Object({ title: Type.String({ minLength: 1, maxLength: 200 }) }, { additionalProperties: false }),
  response: { 201: Task },
} satisfies RouteSchemas;
const update = {
  params: Id,
  body: Type.Object(
    { title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })), done: Type.Optional(Type.Boolean()) },
    { additionalProperties: false, minProperties: 1 },
  ),
  response: { 200: Task },
} satisfies RouteSchemas;
const remove = { params: Id, response: { 204: Type.Null() } } satisfies RouteSchemas;

/** As rotas recebem o repositório pelo construtor: a dependência é montada no ponto de composição. */
@Router('/tasks')
export class TaskRoutes {
  constructor(private readonly tasks: TaskRepository) {}

  @Get('/', list)
  list(ctx: Context<typeof list>) {
    return this.tasks.list(ctx.query.done);
  }

  @Get('/:id', getOne)
  get(ctx: Context<typeof getOne>) {
    const task = this.tasks.get(ctx.params.id);
    if (!task) throw notFound('task not found');
    return task;
  }

  @Post('/', create)
  create(ctx: Context<typeof create>) {
    return this.tasks.create(ctx.body.title); // 201: o único status de sucesso do schema
  }

  @Patch('/:id', update)
  update(ctx: Context<typeof update>) {
    const task = this.tasks.update(ctx.params.id, ctx.body);
    if (!task) throw notFound('task not found');
    return task;
  }

  @Delete('/:id', remove)
  remove(ctx: Context<typeof remove>) {
    if (!this.tasks.remove(ctx.params.id)) throw notFound('task not found'); // 204 vem do schema
  }
}

/** O app, sem `listen()`: o `server.ts` sobe o servidor, e o teste usa `app.inject()`. */
export function buildApp(tasks: TaskRepository) {
  const app = createApp({ requireSchemas: true, logger: false });
  app.mount(new TaskRoutes(tasks));
  app.onClose(() => tasks.close());
  return app;
}

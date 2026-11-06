import { Type } from "@sinclair/typebox";
import {
  type Context, Router, Delete, Get, Patch, Post, type RouteSchemas, Schema, badRequest, notFound, timer,
} from "sashiko";
import {
  CreateUserSchema, GreetingSchema, ListUsersQuery, UpdateUserSchema, UserIdParams, UserSchema,
} from "../schema/UserSchema.ts";
import type { UserRepository } from "../store/users.ts";
import type { User } from "../types/user.ts";

// Schemas de cada rota num objeto: o mesmo valor vai no verbo (@Get(path, schemas)) e no Context<typeof ...> (F-02)
const list = { query: ListUsersQuery, response: { 200: Type.Array(UserSchema) } } satisfies RouteSchemas;
const byId = { params: UserIdParams, response: { 200: UserSchema } } satisfies RouteSchemas;
const create = { body: CreateUserSchema, response: { 201: UserSchema } } satisfies RouteSchemas;
const update = { params: UserIdParams, body: UpdateUserSchema, response: { 200: UserSchema } } satisfies RouteSchemas;
const remove = { params: UserIdParams, response: { 204: Type.Null() } } satisfies RouteSchemas;
const greet = { params: UserIdParams, body: Type.Object({}), response: { 200: GreetingSchema } } satisfies RouteSchemas;

@Router('/users')
export class UserRoutes {
  // Dependência injetada pelo construtor: app.mount(new UserRoutes(repo)) (B-10)
  constructor(private readonly users: UserRepository) {}

  private findOr404(id: string): User {
    const user = this.users.get(id);
    if (!user) throw notFound('user not found');
    return user;
  }

  private assertEmailFree(email: string, exceptId?: string) {
    const existing = this.users.findByEmail(email);
    if (existing && existing.id !== exceptId) throw badRequest('email already registered');
  }

  // GET /users?limit=10&offset=0 — query com coerção e defaults; ?tag=a&tag=b viraria array (B-07)
  @Get('/', list)
  listUsers(ctx: Context<typeof list>) {
    const { limit, offset } = ctx.query; // number, já coagidos e com default (F-02)
    return this.users.list(offset, limit);
  }

  // GET /users/:id — também responde HEAD automaticamente (F-08)
  @Get('/:id', byId)
  getUser(ctx: Context<typeof byId>) {
    return this.findOr404(ctx.params.id);
  }

  @Post('/', create)
  createUser(ctx: Context<typeof create>) {
    this.assertEmailFree(ctx.body.email);
    const user: User = { id: crypto.randomUUID(), ...ctx.body };
    this.users.save(user);
    ctx.log.info({ userId: user.id }, 'user created'); // logger com reqId (F-06)
    // Sem ctx.status(201): o único 2xx declarado no schema vira o status padrão (B-05)
    return user;
  }

  @Patch('/:id', update)
  updateUser(ctx: Context<typeof update>) {
    const user = this.findOr404(ctx.params.id);
    if (ctx.body.email) this.assertEmailFree(ctx.body.email, user.id);
    const updated: User = { ...user, ...ctx.body };
    this.users.save(updated);
    return updated;
  }

  @Delete('/:id', remove)
  deleteUser(ctx: Context<typeof remove>) {
    this.findOr404(ctx.params.id);
    this.users.delete(ctx.params.id);
    ctx.status(204);
  }

  // Sem verbo: a classe não expõe este método sozinha. Quem decide o path é o server.ts,
  // com app.mount(...).get('/export.csv', (r) => r.exportCsv) (F-30).
  @Schema({ response: { 200: Type.String() } })
  exportCsv(ctx: Context) {
    const rows = this.users.list(0, 1000).map((u) => `${u.id},${JSON.stringify(u.name)},${u.email}`);
    ctx.send(['id,name,email', ...rows].join('\n') + '\n', 'text/csv; charset=utf-8');
  }

  // Forma verbosa, com @Schema separado: equivale ao segundo argumento do verbo.
  // @timer() mede inclusive o tempo aguardado em handlers async (B-04)
  @Post('/:id/greet')
  @Schema(greet)
  @timer()
  async greet(ctx: Context<typeof greet>) {
    const user = this.findOr404(ctx.params.id);
    await new Promise((r) => setTimeout(r, 50));
    return { message: `Olá, ${user.name}!` };
  }
}

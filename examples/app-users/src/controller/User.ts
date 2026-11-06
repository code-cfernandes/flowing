import { Type } from "@sinclair/typebox";
import {
  type Context, Controller, Delete, Get, Patch, Post, type RouteSchemas, Schema, badRequest, notFound, timer,
} from "picodecor";
import {
  CreateUserSchema, GreetingSchema, ListUsersQuery, UpdateUserSchema, UserIdParams, UserSchema,
} from "../schema/UserSchema.ts";
import type { UserRepository } from "../store/users.ts";
import type { User } from "../types/user.ts";

// Schemas de cada rota num objeto: o mesmo valor alimenta o @Schema e o Context<typeof ...> (F-02)
const list = { query: ListUsersQuery, response: { 200: Type.Array(UserSchema) } } satisfies RouteSchemas;
const byId = { params: UserIdParams, response: { 200: UserSchema } } satisfies RouteSchemas;
const create = { body: CreateUserSchema, response: { 201: UserSchema } } satisfies RouteSchemas;
const update = { params: UserIdParams, body: UpdateUserSchema, response: { 200: UserSchema } } satisfies RouteSchemas;
const remove = { params: UserIdParams, response: { 204: Type.Null() } } satisfies RouteSchemas;
const greet = { params: UserIdParams, body: Type.Object({}), response: { 200: GreetingSchema } } satisfies RouteSchemas;

@Controller('/users')
export class UserController {
  // Dependência injetada pelo construtor: app.controllers([new UserController(repo)]) (B-10)
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
  @Get('/')
  @Schema(list)
  listUsers(ctx: Context<typeof list>) {
    const { limit, offset } = ctx.query; // number, já coagidos e com default (F-02)
    return this.users.list(offset, limit);
  }

  // GET /users/:id — também responde HEAD automaticamente (F-08)
  @Get('/:id')
  @Schema(byId)
  getUser(ctx: Context<typeof byId>) {
    return this.findOr404(ctx.params.id);
  }

  @Post('/')
  @Schema(create)
  createUser(ctx: Context<typeof create>) {
    this.assertEmailFree(ctx.body.email);
    const user: User = { id: crypto.randomUUID(), ...ctx.body };
    this.users.save(user);
    ctx.log.info({ userId: user.id }, 'user created'); // logger com reqId (F-06)
    // Sem ctx.status(201): o único 2xx declarado no schema vira o status padrão (B-05)
    return user;
  }

  @Patch('/:id')
  @Schema(update)
  updateUser(ctx: Context<typeof update>) {
    const user = this.findOr404(ctx.params.id);
    if (ctx.body.email) this.assertEmailFree(ctx.body.email, user.id);
    const updated: User = { ...user, ...ctx.body };
    this.users.save(updated);
    return updated;
  }

  @Delete('/:id')
  @Schema(remove)
  deleteUser(ctx: Context<typeof remove>) {
    this.findOr404(ctx.params.id);
    this.users.delete(ctx.params.id);
    ctx.status(204);
  }

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

import { Type } from "@sinclair/typebox";
import { type Context, Controller, Delete, Get, Patch, Post, Schema, badRequest, notFound, timer } from "picodecor";
import {
  CreateUserSchema, GreetingSchema, ListUsersQuery, UpdateUserSchema, UserIdParams, UserSchema,
} from "../schema/UserSchema.ts";
import type { UserRepository } from "../store/users.ts";
import type { CreateUserInput, ListUsersParams, UpdateUserInput, User } from "../types/user.ts";

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
  @Schema({ query: ListUsersQuery, response: { 200: Type.Array(UserSchema) } })
  listUsers(ctx: Context) {
    const { limit, offset } = ctx.query as unknown as ListUsersParams;
    return this.users.list(offset, limit);
  }

  // GET /users/:id — também responde HEAD automaticamente (F-08)
  @Get('/:id')
  @Schema({ params: UserIdParams, response: { 200: UserSchema } })
  getUser(ctx: Context) {
    return this.findOr404(ctx.params.id!);
  }

  @Post('/')
  @Schema({ body: CreateUserSchema, response: { 201: UserSchema } })
  createUser(ctx: Context) {
    const body = ctx.body as CreateUserInput;
    this.assertEmailFree(body.email);
    const user: User = { id: crypto.randomUUID(), ...body };
    this.users.save(user);
    // Sem ctx.status(201): o único 2xx declarado no schema vira o status padrão (B-05)
    return user;
  }

  @Patch('/:id')
  @Schema({ params: UserIdParams, body: UpdateUserSchema, response: { 200: UserSchema } })
  updateUser(ctx: Context) {
    const user = this.findOr404(ctx.params.id!);
    const changes = ctx.body as UpdateUserInput;
    if (changes.email) this.assertEmailFree(changes.email, user.id);
    const updated: User = { ...user, ...changes };
    this.users.save(updated);
    return updated;
  }

  @Delete('/:id')
  @Schema({ params: UserIdParams, response: { 204: Type.Null() } })
  deleteUser(ctx: Context) {
    this.findOr404(ctx.params.id!);
    this.users.delete(ctx.params.id!);
    ctx.status(204);
  }

  // @timer() mede inclusive o tempo aguardado em handlers async (B-04)
  @Post('/:id/greet')
  @Schema({ params: UserIdParams, body: Type.Object({}), response: { 200: GreetingSchema } })
  @timer()
  async greet(ctx: Context) {
    const user = this.findOr404(ctx.params.id!);
    await new Promise((r) => setTimeout(r, 50));
    return { message: `Olá, ${user.name}!` };
  }
}

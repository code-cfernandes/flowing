import { Type } from "@sinclair/typebox";
import { type Context, Controller, Delete, Get, Patch, Post, Schema, badRequest, notFound, timer } from "picodecor";
import {
  CreateUserSchema, GreetingSchema, ListUsersQuery, UpdateUserSchema, UserIdParams, UserSchema,
} from "../schema/UserSchema.ts";
import { users } from "../store/users.ts";
import type { CreateUserInput, ListUsersParams, UpdateUserInput, User } from "../types/user.ts";

function findOr404(id: string): User {
  const user = users.get(id);
  if (!user) throw notFound('user not found');
  return user;
}

function assertEmailFree(email: string, exceptId?: string) {
  for (const u of users.values()) {
    if (u.email === email && u.id !== exceptId) throw badRequest('email already registered');
  }
}

@Controller('/users')
export class UserController {
  // GET /users?limit=10&offset=0 — query com coerção e defaults
  @Get('/')
  @Schema({ query: ListUsersQuery, response: { 200: Type.Array(UserSchema) } })
  listUsers(ctx: Context) {
    const { limit, offset } = ctx.query as unknown as ListUsersParams;
    return Array.from(users.values()).slice(offset, offset + limit);
  }

  // GET /users/:id — também responde HEAD automaticamente (F-08)
  @Get('/:id')
  @Schema({ params: UserIdParams, response: { 200: UserSchema } })
  getUser(ctx: Context) {
    return findOr404(ctx.params.id!);
  }

  @Post('/')
  @Schema({ body: CreateUserSchema, response: { 201: UserSchema } })
  createUser(ctx: Context) {
    const body = ctx.body as CreateUserInput;
    assertEmailFree(body.email);
    const user: User = { id: crypto.randomUUID(), ...body };
    users.set(user.id, user);
    ctx.status(201);
    return user;
  }

  @Patch('/:id')
  @Schema({ params: UserIdParams, body: UpdateUserSchema, response: { 200: UserSchema } })
  updateUser(ctx: Context) {
    const user = findOr404(ctx.params.id!);
    const changes = ctx.body as UpdateUserInput;
    if (changes.email) assertEmailFree(changes.email, user.id);
    const updated: User = { ...user, ...changes };
    users.set(user.id, updated);
    return updated;
  }

  @Delete('/:id')
  @Schema({ params: UserIdParams, response: { 204: Type.Null() } })
  deleteUser(ctx: Context) {
    findOr404(ctx.params.id!);
    users.delete(ctx.params.id!);
    ctx.status(204);
  }

  // @timer() mede inclusive o tempo aguardado em handlers async (B-04)
  @Post('/:id/greet')
  @Schema({ params: UserIdParams, body: Type.Object({}), response: { 200: GreetingSchema } })
  @timer()
  async greet(ctx: Context) {
    const user = findOr404(ctx.params.id!);
    await new Promise((r) => setTimeout(r, 50));
    return { message: `Olá, ${user.name}!` };
  }
}

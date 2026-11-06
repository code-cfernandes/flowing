import { Type } from "@sinclair/typebox";
import { Controller, Get, Post, Schema, badRequest, notFound } from "picodecor";
import type { Context } from "vm";
import { CreateUserSchema, UserSchema } from "../schema/UserSchema.ts";
import type { CreateUserInput, User } from "../types/user.ts";

// ---------- "Banco" em memória ----------
const users = new Map<string, User>();


// ---------- Controller ----------
@Controller('/users')
export class UserController {
  @Get('/:id')
  @Schema({
    params: Type.Object({ id: Type.String() }),
    response: { 200: UserSchema },
  })
  getUser(ctx: Context) {
    const user = users.get(ctx.params.id!);
    if (!user) throw notFound('user not found');
    return user;
  }

  @Get('/')
  @Schema({
    response: { 200: Type.Array(UserSchema) },
  })
  listUsers(ctx: Context) {
    return Array.from(users.values());
  }

  @Post('/')
  @Schema({
    body: CreateUserSchema,
    response: { 201: UserSchema },
  })
  createUser(ctx: Context) {
    const body = ctx.body as CreateUserInput;

    // Defesa extra: o schema já valida, mas o tipo fica explícito
    for (const u of users.values()) {
      if (u.email === body.email) throw badRequest('email already registered');
    }

    const user: User = { id: crypto.randomUUID(), ...body };
    users.set(user.id, user);
    ctx.status(201);
    return user;
  }

  @Post('/:id/greet')
  @Schema({
    params: Type.Object({ id: Type.String() }),
  })
  async greet(ctx: Context) {
    const user = users.get(ctx.params.id!);
    if (!user) throw notFound('user not found');
    await new Promise((r) => setTimeout(r, 50));
    return { message: `Olá, ${user.name}!` };
  }
}

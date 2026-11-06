// examples/users/app.ts
import { Type, type Static } from '@sinclair/typebox';
import { Controller, Get, Post, Schema } from './decorators/index.ts';
import { badRequest, Context, createApp, notFound } from './picodecor/index.ts';

// ---------- Schemas ----------
const UserSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  email: Type.String({ format: 'email' }),
});
type User = Static<typeof UserSchema>;

const CreateUserSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  email: Type.String({ format: 'email' }),
});
type CreateUserInput = Static<typeof CreateUserSchema>;

// ---------- "Banco" em memória ----------
const users = new Map<string, User>();

// ---------- Controller ----------
@Controller('/users')
class UserController {
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

// ---------- App ----------
const app = createApp({ bodyLimit: 64 * 1024 });
app.controllers([UserController]);

const server = app.listen(3000);

// ---------- Graceful shutdown ----------
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

console.log('PicoDecor running at http://127.0.0.1:3000');
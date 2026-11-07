import { bearerAuth, type Context, createApp, Get, type Guard, Guards, Post, Router, type RouteSchemas, Type, unauthorized } from 'sashiko';
import { type Claims, signToken, verifyToken } from './jwt.ts';
import type { UserStore } from './users.ts';

// O `bearerAuth` guarda em `ctx.state.user` o que o `verify` devolve. Num app, declare o tipo uma vez com
// `declare module 'sashiko' { interface ContextState { user?: Claims } }`; aqui, por estar no mesmo projeto
// dos testes do framework, a leitura é local.
const userOf = (ctx: Context) => ctx.state.user as Claims | undefined;

const login = {
  body: Type.Object({ email: Type.String({ format: 'email' }), password: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  response: { 200: Type.Object({ token: Type.String(), expiresIn: Type.Integer() }) },
} satisfies RouteSchemas;
const me = { response: { 200: Type.Object({ id: Type.String(), role: Type.String() }) } } satisfies RouteSchemas;
const report = { response: { 200: Type.Object({ users: Type.Integer() }) } } satisfies RouteSchemas;

const isAdmin: Guard = (ctx) => userOf(ctx)?.role === 'admin'; // false → 403

export function buildApp(users: UserStore, secret: string) {
  const TTL = 900;

  @Router('/auth')
  class AuthRoutes {
    @Post('/login', login)
    login(ctx: Context<typeof login>) {
      const user = users.authenticate(ctx.body.email, ctx.body.password);
      // A mesma resposta para e-mail inexistente e senha errada: não revela quem tem conta.
      if (!user) throw unauthorized('invalid credentials');
      return { token: signToken({ sub: user.id, role: user.role }, secret, TTL), expiresIn: TTL };
    }
  }

  // O guard de autenticação vale para a classe toda; o `isAdmin`, só para o método.
  @Router('/me')
  @Guards(bearerAuth({ verify: (token) => verifyToken(token, secret) ?? false }))
  class MeRoutes {
    @Get('/', me)
    me(ctx: Context<typeof me>) {
      const user = userOf(ctx)!;
      return { id: user.sub, role: user.role };
    }

    @Get('/admin/report', report)
    @Guards(isAdmin)
    report() {
      return { users: 2 };
    }
  }

  const app = createApp({ requireSchemas: true, logger: false });
  app.mount(AuthRoutes).mount(MeRoutes);
  return app;
}

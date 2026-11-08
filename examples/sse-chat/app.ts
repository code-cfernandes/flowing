import { type Context, createApp, Get, Post, Router, type RouteSchemas, Type } from 'flowingts';
import type { ChatHub } from './hub.ts';

const post = {
  body: Type.Object(
    { author: Type.String({ minLength: 1, maxLength: 40 }), text: Type.String({ minLength: 1, maxLength: 500 }) },
    { additionalProperties: false },
  ),
  response: { 201: Type.Object({ id: Type.Integer() }) },
} satisfies RouteSchemas;

@Router('/chat')
export class ChatRoutes {
  constructor(private readonly hub: ChatHub) {}

  /** `EventSource('/chat/events')` no navegador. A conexão fica aberta até o cliente sair ou o app encerrar. */
  @Get('/events')
  events(ctx: Context) {
    this.hub.join(ctx.sse({ heartbeatMs: 15_000 }));
  }

  @Post('/messages', post)
  post(ctx: Context<typeof post>) {
    return { id: this.hub.post(ctx.body.author, ctx.body.text).id };
  }
}

export function buildApp(hub: ChatHub) {
  const app = createApp({ logger: false });
  app.mount(new ChatRoutes(hub));
  return app;
}

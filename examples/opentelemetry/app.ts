import * as otel from '@opentelemetry/api';
import { type AppOptions, type Context, createApp, Get, notFound, Router, type RouteSchemas, Type } from 'flowingts';

const Order = Type.Object({ id: Type.String(), total: Type.Number() });
const getOrder = { params: Type.Object({ id: Type.String() }), response: { 200: Order } } satisfies RouteSchemas;

const tracer = otel.trace.getTracer('pedidos');
const orders = new Map([['42', { id: '42', total: 99.9 }]]);

@Router('/orders')
export class OrderRoutes {
  @Get('/:id', getOrder)
  async get(ctx: Context<typeof getOrder>) {
    // Um span da aplicação: vira filho do span da requisição, com o mesmo traceId.
    const order = await tracer.startActiveSpan('db.find_order', async (span) => {
      span.setAttribute('order.id', ctx.params.id);
      await new Promise((r) => setTimeout(r, 5)); // a consulta ao banco
      span.end();
      return orders.get(ctx.params.id);
    });
    ctx.log.info({ orderId: ctx.params.id }, 'order lookup'); // traceId e spanId no log
    if (!order) throw notFound('order not found');
    return order;
  }
}

/** `telemetry: otel` liga spans e métricas do FlowingTS; sem a opção, nada disso é carregado. */
export function buildApp(options: Pick<AppOptions, 'logger'> = {}) {
  const app = createApp({ telemetry: otel, ...options });
  app.mount(OrderRoutes);
  return app;
}

import { type Context, contracts, createApp, Get, notFound, Post, Router, type RouteSchemas } from 'flowingts';
import { z } from 'zod';

// Os schemas podem vir de um pacote compartilhado com o site e o app.
export const Membro = z.object({
  nome: z.string().trim().min(2),
  email: z.email(),
  ministerios: z.array(z.string()).default([]),
});
const Saida = z.object({ id: z.number(), nome: z.string(), ministerios: z.array(z.string()) });

const criar = { body: Membro, response: { 201: Saida } } satisfies RouteSchemas;
const buscar = {
  params: z.object({ id: z.coerce.number().int().positive() }),
  response: { 200: Saida },
} satisfies RouteSchemas;

type Registro = z.infer<typeof Saida> & { email: string; criadoEm: Date };

@Router('/membros')
export class MembroRoutes {
  private readonly registros = new Map<number, Registro>();

  @Post('/', criar)
  criar(ctx: Context<typeof criar>) {
    const id = this.registros.size + 1;
    const registro = { id, ...ctx.body, criadoEm: new Date() };
    this.registros.set(id, registro);
    return registro; // o schema da saída deixa e-mail e criadoEm de fora
  }

  @Get('/:id', buscar)
  buscar(ctx: Context<typeof buscar>) {
    const registro = this.registros.get(ctx.params.id); // id já é number, pelo z.coerce
    if (!registro) throw notFound('membro não encontrado');
    return registro;
  }
}

/** Contratos em Zod: o motor Standard Schema, com o OpenAPI gerado pelo próprio Zod. */
export function buildApp() {
  const app = createApp({
    logger: false,
    contracts: contracts.standard({ toJSONSchema: (schema) => z.toJSONSchema(schema as z.ZodType) }),
  });
  app.mount(new MembroRoutes()).openapi({ docs: true });
  return app;
}

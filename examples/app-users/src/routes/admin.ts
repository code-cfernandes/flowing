import { Get, Router, Schema, Type } from "sashiko";
import { AdminHeaders, HealthSchema, StatsSchema } from "../schema/AdminSchema.ts";
import type { UserRepository } from "../store/users.ts";

// Classe base: as subclasses herdam GET /health com o próprio prefixo (B-09)
@Router('/')
export class HealthRoutes {
  @Get('/health')
  @Schema({ response: { 200: HealthSchema } })
  health() {
    return { status: 'ok' as const, uptime: process.uptime() };
  }
}

// A proteção por API key é aplicada no server.ts, no ponto de composição (F-28)
@Router('/admin')
export class AdminRoutes extends HealthRoutes {
  constructor(private readonly users: UserRepository) {
    super();
  }

  // Header documentado e validado por schema (B-03); a autorização em si é do guard
  @Get('/stats')
  @Schema({ headers: AdminHeaders, response: { 200: StatsSchema } })
  stats() {
    return { users: this.users.count(), memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024) };
  }

  // Erro inesperado: o cliente recebe 500 genérico, o detalhe só aparece no log do servidor (S-05)
  @Get('/boom')
  @Schema({ response: { 200: Type.Object({}) } })
  boom() {
    throw new Error('connection refused: postgres://admin:s3cr3t@db:5432');
  }
}

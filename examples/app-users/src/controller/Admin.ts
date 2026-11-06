import { Type } from "@sinclair/typebox";
import { Controller, Get, Schema, UseGuards } from "picodecor";
import { apiKeyGuard } from "../guards/api-key.ts";
import { AdminHeaders, HealthSchema, StatsSchema } from "../schema/AdminSchema.ts";
import type { UserRepository } from "../store/users.ts";

// Controller base: as subclasses herdam GET /health com o próprio prefixo (B-09)
@Controller('/')
export class HealthController {
  @Get('/health')
  @Schema({ response: { 200: HealthSchema } })
  health() {
    return { status: 'ok' as const, uptime: process.uptime() };
  }
}

// Todas as rotas de /admin exigem a API key, inclusive as herdadas (F-01)
@UseGuards(apiKeyGuard)
@Controller('/admin')
export class AdminController extends HealthController {
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

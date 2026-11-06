import { Type } from "@sinclair/typebox";
import { type Context, Controller, Get, Schema, unauthorized } from "picodecor";
import { AdminHeaders, HealthSchema, StatsSchema } from "../schema/AdminSchema.ts";
import { users } from "../store/users.ts";

const API_KEY = process.env.ADMIN_API_KEY ?? 'dev-admin-key';

// Controller base: as subclasses herdam GET /health com o próprio prefixo (B-09)
@Controller('/')
export class HealthController {
  @Get('/health')
  @Schema({ response: { 200: HealthSchema } })
  health() {
    return { status: 'ok' as const, uptime: process.uptime() };
  }
}

@Controller('/admin')
export class AdminController extends HealthController {
  // Header obrigatório validado por schema (B-03)
  @Get('/stats')
  @Schema({ headers: AdminHeaders, response: { 200: StatsSchema } })
  stats(ctx: Context) {
    if (ctx.req.headers['x-api-key'] !== API_KEY) throw unauthorized('invalid api key');
    return { users: users.size, memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024) };
  }

  // Erro inesperado: o cliente recebe 500 genérico, o detalhe só aparece no log do servidor (S-05)
  @Get('/boom')
  @Schema({ response: { 200: Type.Object({}) } })
  boom() {
    throw new Error('connection refused: postgres://admin:s3cr3t@db:5432');
  }
}

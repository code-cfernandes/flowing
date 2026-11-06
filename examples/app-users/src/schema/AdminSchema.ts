import { Type } from "sashiko";

export const HealthSchema = Type.Object({ status: Type.Literal('ok'), uptime: Type.Number() });

// Headers chegam em minúsculas; o schema é validado sobre uma cópia de req.headers (B-03)
export const AdminHeaders = Type.Object({ 'x-api-key': Type.String({ minLength: 8 }) });

export const StatsSchema = Type.Object({ users: Type.Integer(), memoryMb: Type.Number() });

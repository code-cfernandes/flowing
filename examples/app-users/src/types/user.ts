import type { Static } from "@sinclair/typebox";
import type { CreateUserSchema, UpdateUserSchema, UserSchema } from "../schema/UserSchema.ts";

export type User = Static<typeof UserSchema>;
export type CreateUserInput = Static<typeof CreateUserSchema>;
export type UpdateUserInput = Static<typeof UpdateUserSchema>;

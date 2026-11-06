import type { Static } from "@sinclair/typebox";
import type { CreateUserSchema, UserSchema } from "../schema/UserSchema.ts";

export type User = Static<typeof UserSchema>;

export type CreateUserInput = Static<typeof CreateUserSchema>;
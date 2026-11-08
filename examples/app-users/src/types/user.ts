import type { Static } from 'flowingts';
import type { CreateUserSchema, UpdateUserSchema, UserSchema } from '../schema/UserSchema.ts';

export type User = Static<typeof UserSchema>;
export type CreateUserInput = Static<typeof CreateUserSchema>;
export type UpdateUserInput = Static<typeof UpdateUserSchema>;

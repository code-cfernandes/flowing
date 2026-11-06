import { Type } from "@sinclair/typebox";

export const UserSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  email: Type.String({ format: 'email' }),
});
export const CreateUserSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  email: Type.String({ format: 'email' }),
});
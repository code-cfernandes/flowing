import { Type } from "sashiko";

export const UserSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  email: Type.String({ format: 'email' }),
});

// additionalProperties: false → campos extras no body geram 400 (proteção contra mass assignment, S-07)
export const CreateUserSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100 }),
    email: Type.String({ format: 'email' }),
  },
  { additionalProperties: false },
);

export const UpdateUserSchema = Type.Partial(CreateUserSchema, { additionalProperties: false, minProperties: 1 });

export const UserIdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

// Query chega como string; o framework converte para integer (coerção só em params/query/headers, B-06)
export const ListUsersQuery = Type.Object({
  limit: Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
  offset: Type.Integer({ minimum: 0, default: 0 }),
});

export const GreetingSchema = Type.Object({ message: Type.String() });

import type { User } from "../types/user.ts";

// "Banco" em memória compartilhado entre os controllers
export const users = new Map<string, User>();

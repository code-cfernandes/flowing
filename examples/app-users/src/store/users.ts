import type { User } from "../types/user.ts";

/**
 * Repositório em memória. Em produção seria um adapter de banco com a mesma interface;
 * as classes de rotas recebem a instância pelo construtor (B-10), o que facilita trocar e testar.
 */
export class UserRepository {
  private readonly users = new Map<string, User>();

  list(offset: number, limit: number): User[] {
    return Array.from(this.users.values()).slice(offset, offset + limit);
  }
  get(id: string): User | undefined { return this.users.get(id); }
  save(user: User): void { this.users.set(user.id, user); }
  delete(id: string): boolean { return this.users.delete(id); }
  count(): number { return this.users.size; }
  findByEmail(email: string): User | undefined {
    for (const u of this.users.values()) if (u.email === email) return u;
    return undefined;
  }
}

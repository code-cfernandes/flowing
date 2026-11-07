import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
}

/** Usuários em memória, com a senha guardada como hash `scrypt` (nunca em texto). */
export class UserStore {
  private readonly byEmail = new Map<string, User & { salt: Buffer; hash: Buffer }>();

  add(user: User, password: string): void {
    const salt = randomBytes(16);
    this.byEmail.set(user.email, { ...user, salt, hash: scryptSync(password, salt, 32) });
  }

  /** O usuário, se a senha confere. A comparação do hash tem tempo constante. */
  authenticate(email: string, password: string): User | undefined {
    const entry = this.byEmail.get(email);
    if (!entry) return undefined;
    const hash = scryptSync(password, entry.salt, 32);
    if (!timingSafeEqual(hash, entry.hash)) return undefined;
    return { id: entry.id, email: entry.email, role: entry.role };
  }
}

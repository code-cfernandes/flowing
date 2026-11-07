import { createHmac } from 'node:crypto';
import { safeEqual } from 'sashiko';

/**
 * JWT HS256 mínimo com `node:crypto`, para o exemplo não depender de biblioteca. Em produção, prefira uma
 * biblioteca mantida (`jose`, por exemplo), que cobre outros algoritmos, `kid` e rotação de chaves.
 */
export interface Claims {
  sub: string;
  role: 'admin' | 'user';
  iat: number;
  exp: number;
}

const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');
const HEADER = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

const signature = (data: string, secret: string) => createHmac('sha256', secret).update(data).digest('base64url');

export function signToken(claims: Pick<Claims, 'sub' | 'role'>, secret: string, ttlSeconds = 900, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const body = `${HEADER}.${b64(JSON.stringify({ ...claims, iat, exp: iat + ttlSeconds }))}`;
  return `${body}.${signature(body, secret)}`;
}

/** Devolve as claims de um token válido e não expirado, ou `undefined`. */
export function verifyToken(token: string, secret: string, now = Date.now()): Claims | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const [header, payload, sig] = parts as [string, string, string];
  // Só o cabeçalho que nós mesmos emitimos: recusa `alg: none` e qualquer troca de algoritmo.
  if (header !== HEADER) return undefined;
  if (!safeEqual(sig, signature(`${header}.${payload}`, secret))) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Claims;
    return typeof claims.exp === 'number' && claims.exp > now / 1000 ? claims : undefined;
  } catch {
    return undefined;
  }
}

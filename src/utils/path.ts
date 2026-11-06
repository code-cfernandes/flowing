/** Junta prefixo e caminho com exatamente uma barra entre eles: `('/users/', 'id')` → `/users/id`. */
export function joinPaths(prefix: string, path: string): string {
  const p = prefix.replace(/\/$/, '');
  const s = path.startsWith('/') ? path : `/${path}`;
  return `${p}${s}` || '/';
}

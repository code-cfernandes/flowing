/** Junta prefixo e caminho com exatamente uma barra entre eles: `('/users/', 'id')` → `/users/id`. */
export function joinPaths(prefix: string, path: string): string {
  const p = prefix.replace(/\/$/, '');
  const s = path.startsWith('/') ? path : `/${path}`;
  return `${p}${s}` || '/';
}

const NAME_END = new Set(['/', '-', '.', '(']);

/**
 * Parâmetros de um path na sintaxe do find-my-way (`/:org/users/:id(^\\d+)`, `/files/*`), em ordem (F-29).
 * Lança erro para parâmetro sem nome (`/:`), nome repetido, regex sem fechamento e `*` fora do fim.
 */
export function pathParams(path: string): string[] {
  const names: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    if (ch === '*') {
      if (i !== path.length - 1) throw new Error(`invalid path "${path}": "*" is only allowed at the end`);
      names.push('*');
      continue;
    }
    if (ch !== ':') continue;
    if (path[i + 1] === ':') {
      i++;
      continue;
    } // `::` é um ':' literal
    let j = i + 1;
    while (j < path.length && !NAME_END.has(path[j]!)) j++;
    const name = path.slice(i + 1, j);
    if (!name) throw new Error(`invalid path "${path}": parameter without a name`);
    if (names.includes(name)) throw new Error(`invalid path "${path}": parameter "${name}" is repeated`);
    names.push(name);
    if (path[j] === '(') {
      let depth = 0;
      for (; j < path.length; j++) {
        if (path[j] === '\\') {
          j++;
          continue;
        }
        if (path[j] === '(') depth++;
        else if (path[j] === ')' && --depth === 0) break;
      }
      if (depth !== 0) throw new Error(`invalid path "${path}": unterminated regex for "${name}"`);
    }
    i = j - (path[j] === ')' ? 0 : 1);
  }
  return names;
}

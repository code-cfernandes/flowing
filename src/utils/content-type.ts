/** Media type sem parâmetros e em minúsculas: `"Application/JSON; charset=utf-8"` → `"application/json"`. */
export function mediaType(header: string | undefined): string {
  return header ? header.split(';', 1)[0]!.trim().toLowerCase() : '';
}

/** `application/json` ou `application/*+json`, com parâmetros opcionais (B-11). */
export function isJsonContentType(header: string | undefined): boolean {
  const type = mediaType(header);
  return type === 'application/json' || /^application\/[a-z0-9!#$&^_.-]+\+json$/.test(type);
}

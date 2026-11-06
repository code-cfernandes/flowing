import { STATUS_CODES } from 'node:http';
import type { CompiledRoute } from '../core/compiler.ts';
import type { Middleware } from '../core/compose.ts';
import type { Guard } from '../core/guard.ts';
import { isResponseContent, type ResponseEntry } from '../core/metadata.ts';

/** Opções de `app.openapi()` (F-16). */
export interface OpenAPIOptions {
  /** Padrão: `{ title: 'API', version: '0.0.0' }`. */
  info?: { title: string; version: string; description?: string; [key: string]: unknown };
  servers?: readonly { url: string; description?: string }[];
  /** Onde servir o documento JSON. Padrão: `'/openapi.json'`. */
  path?: string;
  /** Swagger UI. Desligado por padrão: `true` serve em `'/docs'`, uma string escolhe o path. */
  docs?: string | boolean;
  /** Rodam antes de servir o documento e a página, depois dos middlewares globais. */
  middlewares?: readonly Middleware[];
  /** Rodam depois dos `middlewares`, como nas rotas (401/403 antes de gerar o documento). */
  guards?: readonly Guard[];
}

type Json = Record<string, unknown>;

/** Cópia em JSON puro: tira as chaves `Symbol` do TypeBox e qualquer coisa não serializável. */
const plain = (schema: object): Json => JSON.parse(JSON.stringify(schema)) as Json;

/** `/:org/users/:id(^\\d+)` → `/{org}/users/{id}`; `::` → `:`; `*` → `{*}`; sem barra final (o roteador a ignora). */
export function toOpenAPIPath(path: string): string {
  return (
    path
      .replace(/::/g, '\u0000')
      .replace(/:([^/\-.(]+)(\((?:\\.|[^\\])*?\))?/g, '{$1}')
      .replace(/\*$/, '{*}')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: desfaz o marcador acima.
      .replace(/\u0000/g, ':')
      .replace(/(.)\/$/, '$1')
  );
}

/** Problem Details (RFC 9457), o corpo padrão de todos os erros (F-15). */
const PROBLEM_SCHEMA: Json = {
  type: 'object',
  required: ['type', 'title', 'status'],
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string' },
    code: { type: 'string' },
    details: {},
  },
};

function parameters(where: 'path' | 'query' | 'header', schema: object | undefined): Json[] {
  const json = schema ? plain(schema) : undefined;
  const props = json?.properties as Record<string, Json> | undefined;
  if (!props) return [];
  const required = new Set((json!.required as string[] | undefined) ?? []);
  return Object.entries(props).map(([name, s]) => ({
    name,
    in: where,
    required: where === 'path' || required.has(name),
    schema: s,
  }));
}

function responseContent(entry: ResponseEntry): Json | undefined {
  if (isResponseContent(entry)) {
    const types = typeof entry.contentType === 'string' ? [entry.contentType] : entry.contentType;
    return Object.fromEntries(types.map((t) => [t, entry.schema ? { schema: plain(entry.schema) } : {}]));
  }
  return { 'application/json': { schema: plain(entry) } };
}

function operation(route: CompiledRoute, problemErrors: boolean): Json {
  const { schemas } = route;
  const params = [...parameters('path', schemas.params), ...parameters('query', schemas.query), ...parameters('header', schemas.headers)];
  const responses: Json = {};
  for (const [status, entry] of Object.entries(schemas.response ?? {})) {
    const content = Number(status) === 204 ? undefined : responseContent(entry);
    responses[status] = { description: STATUS_CODES[Number(status)] ?? 'Response', ...(content ? { content } : {}) };
  }
  if (Object.keys(responses).length === 0) responses['200'] = { description: 'OK' };
  responses.default = problemErrors
    ? { description: 'Error', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } } } }
    : { description: 'Error' };

  return {
    operationId: `${route.owner}.${route.handlerName}`,
    tags: [route.owner],
    ...(params.length ? { parameters: params } : {}),
    ...(schemas.body ? { requestBody: { required: true, content: { 'application/json': { schema: plain(schemas.body) } } } } : {}),
    responses,
  };
}

/**
 * Gera o documento OpenAPI 3.1 a partir das rotas registradas (F-16). Os schemas TypeBox já são
 * JSON Schema, então entram como estão. Schemas que não são JSON Schema (Zod etc.) não são convertidos.
 */
export function generateOpenAPI(routes: readonly CompiledRoute[], opts: OpenAPIOptions, problemErrors: boolean): Json {
  const paths: Record<string, Json> = {};
  const ids = new Map<string, number>();
  for (const route of routes) {
    const path = toOpenAPIPath(route.path);
    const op = operation(route, problemErrors);
    // A mesma classe montada em dois prefixos gera o mesmo id; o OpenAPI exige ids únicos.
    const base = op.operationId as string;
    const n = (ids.get(base) ?? 0) + 1;
    ids.set(base, n);
    if (n > 1) op.operationId = `${base}_${n}`;
    (paths[path] ??= {})[route.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.1.0',
    info: opts.info ?? { title: 'API', version: '0.0.0' },
    ...(opts.servers ? { servers: opts.servers } : {}),
    paths,
    ...(problemErrors ? { components: { schemas: { ProblemDetails: PROBLEM_SCHEMA } } } : {}),
  };
}

const SWAGGER = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.1';
const SWAGGER_JS_SRI = 'sha384-XFYN47VzPiDY6qPtxYKg0nqUeW/upo20xf1j2SUE7gT/i35FJB4cuS/71Iegzk8Z';
const SWAGGER_CSS_SRI = 'sha384-4c3vsE5f+trhFyHrFrLM1fFGUn531NIaC7dcqEWIJdoRQJ5CkJbSuSCwXLpaS1KF';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Página do Swagger UI (versão fixada, com SRI) e a CSP própria dela: scripts só do CDN e o inline com
 * `nonce`, `connect-src 'self'` para buscar o documento.
 */
export function docsPage(specUrl: string, title: string, nonce: string): { html: string; csp: string } {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${SWAGGER}/swagger-ui.css" integrity="${SWAGGER_CSS_SRI}" crossorigin="anonymous">
</head>
<body>
<div id="swagger-ui"></div>
<script src="${SWAGGER}/swagger-ui-bundle.js" integrity="${SWAGGER_JS_SRI}" crossorigin="anonymous"></script>
<script nonce="${nonce}">SwaggerUIBundle({ url: ${JSON.stringify(specUrl).replace(/</g, '\\u003c')}, dom_id: '#swagger-ui' });</script>
</body>
</html>
`;
  const csp = [
    "default-src 'none'",
    `script-src https://cdn.jsdelivr.net 'nonce-${nonce}'`,
    "style-src https://cdn.jsdelivr.net 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return { html, csp };
}

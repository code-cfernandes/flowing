import { randomBytes } from 'node:crypto';
import type { AppCore } from '../app/core.ts';
import { compose, type Middleware } from '../compose.ts';
import type { Context } from '../context.ts';
import type { HealthConfig } from '../health.ts';
import { kRawSend } from '../symbols.ts';
import { docsPage, generateOpenAPI, type OpenAPIOptions } from '../../openapi/generate.ts';
import { canonicalPath } from '../../utils/path.ts';
import type { RouteRegistry } from './registry.ts';

export type OpenAPIConfig = {
  opts: OpenAPIOptions;
  path: string;
  docs: string | false;
  pipeline: Middleware[];
  cache: Map<string, string>;
};

/** Rotas servidas pelo próprio app: healthchecks e OpenAPI (documento e página). */
export class FrameworkRoutes {
  health: HealthConfig | undefined;
  openapi: OpenAPIConfig | undefined;

  constructor(
    private readonly core: AppCore,
    private readonly registry: RouteRegistry,
  ) {}

  /** Paths servidos pelo próprio app (`health()`, `openapi()`), que encobririam uma rota GET do usuário. */
  reservedPaths(except?: 'health' | 'openapi'): Map<string, string> {
    const out = new Map<string, string>();
    if (except !== 'health') for (const p of this.health?.paths ?? []) out.set(p, 'app.health()');
    const cfg = this.openapi;
    if (cfg && except !== 'openapi') {
      out.set(canonicalPath(cfg.path), 'app.openapi()');
      if (cfg.docs) out.set(canonicalPath(cfg.docs), 'app.openapi({ docs })');
    }
    return out;
  }

  /** Um path do framework não pode coincidir com uma rota GET/HEAD registrada nem com outro do framework. */
  assertFreePaths(where: string, paths: readonly string[], kind: 'health' | 'openapi'): void {
    // `health()`/`openapi()` configuram o app, não o grupo: dentro de um `group()` em andamento, a
    // configuração sobreviveria a um grupo desfeito e não enxergaria as rotas ainda pendentes.
    if (this.registry.pending !== undefined) {
      throw new Error(`[sashiko] ${where}: cannot be called inside an app.group() callback; call it on the app, outside the group.`);
    }
    const reserved = this.reservedPaths(kind);
    for (const path of paths) {
      const other = reserved.get(path);
      if (other) throw new Error(`[sashiko] ${where}: path "${path}" is already used by ${other}.`);
      const route = this.registry.routes.find((r) => (r.method === 'GET' || r.method === 'HEAD') && canonicalPath(r.path) === path);
      if (route) {
        throw new Error(
          `[sashiko] ${where}: path "${path}" would shadow ${route.owner}.${route.handlerName} (GET ${route.path}); choose another path.`,
        );
      }
    }
  }

  /** Se a requisição é para `/openapi.json` ou `/docs` (quando ligados), responde e devolve `true`. */
  async serveOpenAPI(ctx: Context): Promise<boolean> {
    const cfg = this.openapi;
    if (!cfg || (ctx.method !== 'GET' && ctx.method !== 'HEAD')) return false;
    const path = canonicalPath(ctx.path);
    const isSpec = path === canonicalPath(cfg.path);
    if (!isSpec && !(cfg.docs && path === canonicalPath(cfg.docs))) return false;

    await compose(ctx, [
      ...cfg.pipeline,
      () => {
        if (isSpec) {
          // Um documento por conjunto de rotas visíveis no host da requisição (F-35); a chave não usa o
          // hostname em si, então hosts arbitrários não fazem o cache crescer.
          const visible = this.registry.routesFor(ctx.hostname.toLowerCase());
          const key = visible.map((r) => this.registry.routes.indexOf(r)).join(',');
          let doc = cfg.cache.get(key);
          if (doc === undefined) {
            doc = JSON.stringify(
              generateOpenAPI(visible, cfg.opts, !this.core.opts.formatError, (s) => this.core.contracts.toJsonSchema(s)),
            );
            cfg.cache.set(key, doc);
          }
          ctx[kRawSend](doc, 'application/json; charset=utf-8');
          return;
        }
        const nonce = randomBytes(16).toString('base64');
        const { html, csp } = docsPage(cfg.path, cfg.opts.info?.title ?? 'API', nonce);
        ctx.res.setHeader('Content-Security-Policy', csp);
        ctx.res.setHeader('Cache-Control', 'no-store');
        ctx[kRawSend](html, 'text/html; charset=utf-8');
      },
    ]);
    return true;
  }
}

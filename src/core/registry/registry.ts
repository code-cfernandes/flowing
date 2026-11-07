import type { AppCore } from '../app/core.ts';
import { assertSchemas } from '../request-validation.ts';
import type { CompiledRoute } from '../compiler.ts';
import { RouteTable } from '../route-table.ts';
import { hostRank, hostReachability, NO_HOST_RANK } from '../../utils/origin-match.ts';
import { canonicalPath } from '../../utils/path.ts';

/** Uma rota validada e ainda não registrada (registro em duas fases). */
export interface PendingRoute {
  owner: string;
  route: CompiledRoute;
  hosts: (string | undefined)[];
}

/**
 * Registro de rotas em duas fases (F-35): `stage()` valida tudo contra o roteador e contra o próprio lote,
 * `commit()` registra e desfaz se algo falhar. Também sabe quais rotas responderiam num host (`routesFor`).
 */
export class RouteRegistry {
  readonly router = new RouteTable();
  readonly routes: CompiledRoute[] = [];
  /** Registros pendentes de um `group()` em andamento. */
  pending: PendingRoute[] | undefined;
  private readonly warnedHosts = new Set<string>();

  constructor(
    private readonly core: AppCore,
    /** Paths servidos pelo próprio app (health, openapi), que uma rota GET não pode encobrir. */
    private readonly reservedPaths: () => Map<string, string>,
    /** Chamado depois de cada commit com rotas (invalida o cache do OpenAPI). */
    private readonly onCommit: () => void,
  ) {}

  /**
   * Primeira fase: valida as rotas (schemas obrigatórios, hosts alcançáveis, conflitos com o roteador e
   * dentro do próprio lote). Dentro de um `group()`, acumula; fora, efetiva na hora.
   */
  stage(owner: string, routes: readonly CompiledRoute[]): void {
    const batch = this.pending ?? [];
    // Checkpoint: dentro de um group(), um mount() que falha no meio não deixa parte dele no lote,
    // mesmo que o callback capture o erro e siga em frente.
    const mark = batch.length;
    try {
      for (const route of routes) {
        // Rotas internas (static) não têm schema por natureza: o requireSchemas vale para as da aplicação.
        if (this.core.opts.requireSchemas && !route.internal) assertSchemas(owner, route);
        if (route.method === 'GET' || route.method === 'HEAD') {
          const reservedBy = this.reservedPaths().get(canonicalPath(route.path));
          if (reservedBy) {
            throw new Error(
              `[sashiko] app.mount(${owner}): GET ${route.path} is served by ${reservedBy} and would never be reached; choose another path.`,
            );
          }
        }
        this.checkReachableHosts(owner, route);
        for (const host of route.hosts.length > 0 ? route.hosts.map((h) => h.key) : [undefined]) {
          const taken =
            this.router.has(route.method, route.path, host) ||
            batch.some(
              (p) => p.route.method === route.method && canonicalPath(p.route.path) === canonicalPath(route.path) && p.hosts.includes(host),
            );
          if (taken) {
            const where = host ? ` on host ${host}` : '';
            throw new Error(
              `[sashiko] app.mount(${owner}): ${route.method} ${route.path}${where} is already registered. ` +
                `Use a different "prefix" or "host" to mount the same class twice.`,
            );
          }
        }
        batch.push({ owner, route, hosts: route.hosts.length > 0 ? route.hosts.map((h) => h.key) : [undefined] });
      }
    } catch (err) {
      batch.length = mark;
      throw err;
    }
    if (this.pending === undefined) this.commit(batch);
  }

  /**
   * Segunda fase: registra o lote no roteador. Se algo ainda falhar (um conflito que o `has()` não prevê),
   * desfaz o que já entrou, e nenhuma rota do lote fica registrada.
   */
  commit(batch: readonly PendingRoute[]): void {
    const done: { method: string; path: string; host: string | undefined }[] = [];
    try {
      for (const { owner, route, hosts } of batch) {
        for (const host of hosts) {
          try {
            this.router.on(route.method, route.path, route, host);
          } catch (err) {
            throw new Error(`[sashiko] app.mount(${owner}): ${route.method} ${route.path} conflicts with a registered route.`, {
              cause: err,
            });
          }
          done.push({ method: route.method, path: route.path, host });
        }
      }
    } catch (err) {
      for (const r of done.reverse()) this.router.off(r.method, r.path, r.host);
      throw err;
    }
    for (const { route } of batch) this.routes.push(route);
    if (batch.length > 0) this.onCommit();
  }

  /**
   * Um host de rota sem interseção com o `allowedHosts` nunca seria alcançado: o app responde 400 antes do
   * roteamento (F-35). Comprovado: erro (ou aviso, com `unreachableHosts: 'warn'`). Sem como provar
   * (RegExp em algum dos lados): aviso.
   */
  private checkReachableHosts(owner: string, route: CompiledRoute): void {
    const mode = this.core.opts.unreachableHosts ?? 'error';
    const allowed = this.core.opts.allowedHosts;
    if (mode === 'off' || !allowed) return;
    for (const host of route.hosts) {
      const verdict = hostReachability(host, allowed);
      if (verdict === 'yes') continue;
      const where = `app.mount(${owner}): ${route.method} ${route.path} uses host ${host.label}`;
      if (verdict === 'no' && mode === 'error') {
        throw new Error(
          `[sashiko] ${where}, which no allowedHosts rule accepts; the route is unreachable. Add it to allowedHosts, or set unreachableHosts: 'warn'.`,
        );
      }
      const key = `${owner} ${host.key}`;
      if (this.warnedHosts.has(key)) continue;
      this.warnedHosts.add(key);
      this.core.log.warn(
        { host: host.label },
        verdict === 'no'
          ? `[sashiko] ${where}, which no allowedHosts rule accepts; the route is unreachable.`
          : `[sashiko] ${where}; could not verify it against allowedHosts (RegExp).`,
      );
    }
  }

  /**
   * Rotas que o roteador **executaria** num host (F-35): para cada método e path, só a vencedora pela mesma
   * prioridade do roteador (exato → curinga mais específico → RegExp → sem host). Assim o OpenAPI documenta
   * exatamente o handler que responde. Sem `hostname`, só as rotas sem host.
   */
  routesFor(hostname: string | undefined): CompiledRoute[] {
    const best = new Map<string, { route: CompiledRoute; rank: number }>();
    for (const [seq, route] of this.routes.entries()) {
      let rank = route.hosts.length === 0 ? NO_HOST_RANK : -1;
      if (rank === -1 && hostname !== undefined) {
        for (const h of route.hosts) {
          if (!h.test(hostname)) continue;
          // Desempate pela ordem de registro, a mesma que o roteador usa em cada path.
          const r = hostRank(h, seq);
          if (rank === -1 || r < rank) rank = r;
        }
      }
      if (rank === -1) continue;
      const key = `${route.method} ${canonicalPath(route.path)}`;
      const current = best.get(key);
      if (!current || rank < current.rank) best.set(key, { route, rank });
    }
    return this.routes.filter((r) => best.get(`${r.method} ${canonicalPath(r.path)}`)?.route === r);
  }
}

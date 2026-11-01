import type { AppClientRouteDefinition } from '@nocobase/app-client/plugins';

import applicationRoutes from '../routes.js';

/**
 * Company scope is declared on the route, but the client runtime resolves
 * routes into a narrower shape that drops unknown fields. Read the declaration
 * from the source tree once and expose it by full path; adding a scoped page is
 * still a single edit on the route itself.
 */
const scopes = new Map<string, string>();

function join(parent: string, path: string | undefined): string {
  if (!path) return parent;
  if (path.startsWith('/')) return path;
  return `${parent.replace(/\/$/u, '')}/${path}`;
}

function collect(
  routes: readonly AppClientRouteDefinition[],
  parent: string,
): void {
  for (const route of routes) {
    const path = join(parent, route.path);
    if (route.companyScope && route.componentLoader) {
      scopes.set(path.replace(/\/+$/u, ''), route.companyScope);
    }
    collect(route.children ?? [], path);
  }
}

for (const contribution of applicationRoutes) {
  collect(contribution.routes ?? [], '');
}

export function companyScopeForRoute(path: string): string | undefined {
  const normalized = path.length > 1 ? path.replace(/\/+$/u, '') : path;
  return scopes.get(normalized);
}

export const companyScopeRoutes = scopes;

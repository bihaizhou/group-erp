import type { AppClientRouteDefinition } from '@nocobase/app-client/plugins';

import applicationRoutes from '../routes.js';

/**
 * Company scope is declared on the route, but the client runtime resolves
 * routes into a narrower shape that drops unknown fields. Read the declaration
 * from the source tree once and expose it by full path; adding a scoped page is
 * still a single edit on the route itself.
 */
const scopes = new Map<string, string>();
const locks = new Set<string>();

function join(parent: string, path: string | undefined): string {
  if (!path) return parent;
  if (path.startsWith('/')) return path;
  return `${parent.replace(/\/$/u, '')}/${path}`;
}

function collect(
  routes: readonly AppClientRouteDefinition[],
  parent: string,
  inheritedLock = false,
): void {
  for (const route of routes) {
    const path = join(parent, route.path),
      normalized = path.replace(/\/+$/u, ''),
      locked = inheritedLock || !!route.lockCompany;
    if (route.companyScope && route.componentLoader) {
      scopes.set(normalized, route.companyScope);
    }
    if (locked) locks.add(normalized);
    else locks.delete(normalized);
    collect(route.children ?? [], path, locked);
  }
}

for (const contribution of applicationRoutes) {
  collect(contribution.routes ?? [], '');
}

const normalize = (path: string) =>
  path.length > 1 ? path.replace(/\/+$/u, '') : path;

export function companyScopeForRoute(path: string): string | undefined {
  return scopes.get(normalize(path));
}

export function companyLockForRoute(path: string): boolean {
  return locks.has(normalize(path));
}

export const companyScopeRoutes = scopes;

import { describe, expect, it } from 'vitest';
import {
  resolveAppClientContributions,
  type AppClientRegisteredRoute,
} from '@nocobase/app-client/plugins';
import applicationRoutes from '../../client/routes.js';
import {
  pagePermissionNavigation,
  type PermissionEditorNavigationNode,
} from '../../client/pages/settings/page-permissions.js';
import { pagePermissionTitles } from '../../client/pages/settings/page-permission-titles.js';

const application = resolveAppClientContributions([
  { packageName: 'page-coverage-app', source: 'application', routes: applicationRoutes },
]);

const flattenRoutes = (
  routes: readonly AppClientRegisteredRoute[],
): AppClientRegisteredRoute[] =>
  routes.flatMap((route) => [route, ...flattenRoutes(route.children ?? [])]);

const flattenNodes = (
  nodes: readonly PermissionEditorNavigationNode[],
  parent?: PermissionEditorNavigationNode,
): { node: PermissionEditorNavigationNode; parent?: PermissionEditorNavigationNode }[] =>
  nodes.flatMap((node) => [
    { node, parent },
    ...flattenNodes(node.children ?? [], node),
  ]);

const text = (value: { key: string } | string): string =>
  typeof value === 'string' ? value : value.key;

const navigation = pagePermissionNavigation(
  application.routes,
  pagePermissionTitles,
  (path) => path,
  text,
);
const entries = flattenNodes(navigation);
const byPath = new Map<string, PermissionEditorNavigationNode>();
for (const { node } of entries) if (node.path) byPath.set(node.path, node);

const isSettingsRoute = (route: AppClientRegisteredRoute): boolean =>
  route.source === 'application' &&
  ['settings', 'systemManagement'].includes(route.name);

const businessPages = flattenRoutes(application.routes).filter(
  (route) =>
    route.componentLoader &&
    route.auth === 'required' &&
    typeof route.authz === 'object' &&
    route.authz.resource.type === 'page' &&
    !isSettingsRoute(route),
);

const parentOf = new Map<string, AppClientRegisteredRoute>();
const recordParents = (routes: readonly AppClientRegisteredRoute[]): void => {
  for (const route of routes) {
    for (const child of route.children ?? []) parentOf.set(child.path, route);
    recordParents(route.children ?? []);
  }
};
recordParents(application.routes);

describe('page tree lists every business page and sub-page', () => {
  it('has a selectable node for every page route', () => {
    const missing = businessPages
      .filter((route) => {
        const node = byPath.get(route.path);
        return !node || !node.pageKey;
      })
      .map((route) => `${route.name} (${route.path})`);
    expect(missing, '每个业务页面/子页面都必须出现在页面树中，并且可以点开配置字段').toEqual([]);
  });

  it('nests every sub-page under its nearest page route', () => {
    const orphans: string[] = [];
    for (const route of businessPages) {
      const node = byPath.get(route.path);
      if (!node) continue;
      const nearest = parentOf.get(route.path);
      if (
        !nearest ||
        !nearest.componentLoader ||
        typeof nearest.authz !== 'object' ||
        nearest.authz.resource.type !== 'page' ||
        isSettingsRoute(nearest)
      )
        continue;
      if (
        typeof route.authz === 'object' &&
        typeof nearest.authz === 'object' &&
        route.authz.resource.id === nearest.authz.resource.id
      )
        continue;
      let current = entries.find((entry) => entry.node === node)?.parent;
      let found = false;
      while (current) {
        if (current.path === nearest.path) {
          found = true;
          break;
        }
        current = entries.find((entry) => entry.node === current)?.parent;
      }
      if (!found)
        orphans.push(`${route.path} should be nested under ${nearest.path}`);
    }
    expect(orphans, '子页面必须挂在它所属的页面节点下面').toEqual([]);
  });
});

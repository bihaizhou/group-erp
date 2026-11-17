import { describe, expect, it } from 'vitest';
import {
  resolveAppClientContributions,
  type AppClientRegisteredRoute,
} from '@nocobase/app-client/plugins';
import applicationRoutes from '../../client/routes.js';
import {
  configurationResources,
  pagePermissionNavigation,
  pagePermissionResources,
} from '../../client/pages/settings/page-permissions.js';
import { permissionRowId } from '../../client/pages/settings/permissions-model.js';
import { pagePermissionTitles } from '../../client/pages/settings/page-permission-titles.js';
import { permissionWorkspaceSelection } from '../../client/pages/settings/permission-workspace.js';

const flatten = (
  routes: readonly AppClientRegisteredRoute[],
): AppClientRegisteredRoute[] =>
  routes.flatMap((route) => [route, ...flatten(route.children ?? [])]);

const application = resolveAppClientContributions([
  {
    packageName: 'page-coverage-app',
    source: 'application',
    routes: applicationRoutes,
  },
]);

const flattenPathNodes = (
  nodes: readonly {
    path?: string;
    children?: readonly { path?: string; children?: unknown[] }[];
  }[],
): { path?: string }[] =>
  nodes.flatMap((node) => [
    node,
    ...flattenPathNodes(
      (node.children ?? []) as readonly {
        path?: string;
        children?: readonly { path?: string; children?: unknown[] }[];
      }[],
    ),
  ]);

const flattenNavigation = (
  nodes: readonly {
    rowId?: string;
    children?: readonly { rowId?: string; children?: unknown[] }[];
  }[],
): string[] =>
  nodes.flatMap((node) => [
    ...(node.rowId ? [node.rowId] : []),
    ...flattenNavigation(
      (node.children ?? []) as readonly {
        rowId?: string;
        children?: readonly { rowId?: string; children?: unknown[] }[];
      }[],
    ),
  ]);

describe('permission editor covers every page', () => {
  it('offers every signed-in page as a page grant or a backend capability', () => {
    const pages = new Set(
      pagePermissionResources(
        application.routes,
        pagePermissionTitles,
        (path) => path,
      ).map((page) => page.id),
    );
    const settings = new Set([
      ...permissionWorkspaceSelection.settings.map((entry) => entry.id),
      'user',
    ]);
    const uncovered = flatten(application.routes)
      .filter(
        (route) =>
          route.componentLoader &&
          route.auth === 'required' &&
          typeof route.authz === 'object',
      )
      .filter((route) => {
        const { type, id } = route.authz!.resource;
        if (type === 'page') return !pages.has(id);
        if (type === 'user') return !settings.has('user');
        return !settings.has(id);
      })
      .map(
        (route) =>
          `${route.name}:${route.authz!.resource.type}:${route.authz!.resource.id}`,
      );
    expect(
      uncovered,
      '每个需要登录的页面都必须出现在页面权限树（page 资源）或后台管理能力里；新增页面时同步 pagePermissionResources/selection。',
    ).toEqual([]);
  });

  it('opens the field panel for every page, even when it has no field resources yet', () => {
    const navigation = pagePermissionNavigation(
      application.routes,
      pagePermissionTitles,
      (path) => path,
      (value) => (typeof value === 'string' ? value : value.key),
    );
    const find = (
      nodes: readonly {
        path?: string;
        pageKey?: string;
        children?: readonly unknown[];
      }[],
    ): { path?: string; pageKey?: string } | undefined => {
      for (const node of nodes) {
        if (node.path === '/functions/finance') return node;
        const child = find((node.children ?? []) as Parameters<typeof find>[0]);
        if (child) return child;
      }
      return undefined;
    };
    expect(find(navigation)?.pageKey).toBe('finance-overview');
    expect(find(navigation)?.path).toBe('/functions/finance');
  });

  it('gives every business page a row in the navigation tree', () => {
    const titles = pagePermissionTitles;
    const unnamed = (path: string) => path;
    const configuration = configurationResources(application.routes);
    const businessPages = pagePermissionResources(
      application.routes,
      titles,
      unnamed,
    ).filter(
      (page) => !configuration.has(JSON.stringify([page.type, page.id])),
    );
    const navigation = pagePermissionNavigation(
      application.routes,
      titles,
      unnamed,
      (value) => (typeof value === 'string' ? value : value.key),
    );
    const rows = new Set(flattenNavigation(navigation));
    const missing = businessPages
      .filter((page) => !rows.has(permissionRowId(page, 'access')))
      .map((page) => page.id);
    expect(
      missing,
      '每个业务页面都必须在权限导航树里有一个可授权的 row；新增页面或调整路由时不能丢失。',
    ).toEqual([]);
    const paths = new Set(
      flattenPathNodes(navigation).flatMap((node) =>
        node.path ? [node.path] : [],
      ),
    );
    expect(paths, '新建采购申请页面必须出现在权限树中').toContain(
      '/functions/procurement/requests/new',
    );
    expect(paths, '新建人事办理页面必须出现在权限树中').toContain(
      '/functions/personnel/changes/new',
    );
  });
});

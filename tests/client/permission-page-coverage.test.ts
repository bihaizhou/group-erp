import { describe, expect, it } from 'vitest';
import {
  resolveAppClientContributions,
  type AppClientRegisteredRoute,
} from '@nocobase/app-client/plugins';
import applicationRoutes from '../../client/routes.js';
import { pagePermissionResources } from '../../client/pages/settings/page-permissions.js';
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
      .map((route) => `${route.name}:${route.authz!.resource.type}:${route.authz!.resource.id}`);
    expect(
      uncovered,
      '每个需要登录的页面都必须出现在页面权限树（page 资源）或后台管理能力里；新增页面时同步 pagePermissionResources/selection。',
    ).toEqual([]);
  });
});

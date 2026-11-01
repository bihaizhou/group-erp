import {
  resolveAppClientContributions,
  type AppClientRegisteredRoute,
  type AppClientRouteComponentLoader,
} from '@nocobase/app-client/plugins';
import { describe, expect, it } from 'vitest';

import applicationRoutes from '../../client/routes.ts';
import { companyScopeRoutes } from '../../client/company/route-scopes.ts';

describe('app client routes', () => {
  it('keeps the landing page and the authentication pages', () => {
    // The authentication plugin and this application have to agree on these paths: it sends an unknown visitor to
    // /login, sends a signed-in user who opens a guest page back to /, and mails a reset link to /reset-password,
    // while the sign-in form links to /register and /forgot-password. Only their presence is asserted, so a page the
    // application adds is not a defect. Whether these four are guest pages is not checked here either: app-client
    // refuses any route that claims one of those paths without `auth: 'guest'`.
    expect(pagePaths(resolveRoutes().routes)).toEqual(
      expect.arrayContaining([
        '/',
        '/login',
        '/register',
        '/forgot-password',
        '/reset-password',
        // The page `deviceAuthorization()`'s verificationUri names, where a CLI's sign-in is approved.
        '/device',
      ]),
    );
  });

  it('loads every page component', async () => {
    const resolved = resolveRoutes();
    const loaders = componentLoadersIn(resolved.routes);
    // The tree above is filtered by loader, so an empty list would make the loop below pass without loading
    // anything at all.
    expect(loaders).not.toHaveLength(0);

    for (const componentLoader of loaders) {
      // The registered loader is already the wrapped one, so awaiting it holds every page to the contract that its
      // module default-exports a component. A page that moved or lost its default export fails here.
      await expect(componentLoader()).resolves.toMatchObject({
        default: expect.any(Function),
      });
    }
  });

  it('declares the company endpoint on every company-scoped page', () => {
    expect(
      [...companyScopeRoutes.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ).toEqual([
      ['/functions/hse', 'hse/companies'],
      ['/functions/hse/certificates', 'hse/companies'],
      ['/functions/hse/hazards', 'hse/companies'],
      ['/functions/hse/incidents', 'hse/companies'],
      ['/functions/procurement/orders', 'procurement/orders/companies'],
      ['/functions/procurement/overview', 'procurement/requestCompanies'],
      ['/functions/procurement/requests', 'procurement/requestCompanies'],
      ['/functions/procurement/settings', 'procurement/settings/companies'],
      ['/functions/procurement/suppliers', 'procurement/supplierCompanies'],
      ['/functions/production/daily', 'production/companies'],
      ['/functions/production/overview', 'production/companies'],
      ['/functions/requisitions/overview', 'requisitions/requestCompanies'],
      ['/functions/requisitions/purposes', 'requisitions/purposeCompanies'],
      ['/functions/requisitions/requests', 'requisitions/requestCompanies'],
      ['/functions/requisitions/settings', 'requisitions/settings/companies'],
      ['/functions/sales/customers', 'procurement/supplierCompanies'],
      ['/functions/sales/orders', 'sales/orders/companies'],
      ['/functions/sales/overview', 'sales/orders/companies'],
      ['/functions/sales/settings', 'warehouse/settings/companies'],
      [
        '/functions/sales/settings/edit/:parameter',
        'warehouse/settings/companies',
      ],
      ['/functions/warehouse/counts', 'warehouse/counts/companies'],
      ['/functions/warehouse/inbounds', 'warehouse/documents/companies'],
      ['/functions/warehouse/inventory', 'warehouse/inventory/companies'],
      ['/functions/warehouse/outbounds', 'warehouse/documents/companies'],
      ['/functions/warehouse/overview', 'warehouse/documents/companies'],
      ['/functions/warehouse/settings', 'warehouse/settings/companies'],
      [
        '/functions/warehouse/settings/edit/:parameter',
        'warehouse/settings/companies',
      ],
      ['/functions/warehouse/transfers', 'warehouse/transfers/companies'],
    ]);
  });

  it('pins the page authorization of every signed-in page', () => {
    // A stored page grant records the page's `authz` resource id (`authorizedAs`), not its route `name`: changing an
    // id is a data change that has to migrate the grants that reference it, not a refactor — so changing this list
    // deliberately is the point. A new page that requires sign-in adds an entry here, because a page that checks
    // access is a new grant somebody has to be given.
    const resolved = resolveRoutes();

    // The landing page and the inbox opted out of page authorization, so they are reachable by every signed-in user.
    const authorizations = pageAuthorizations(resolved.routes);
    expect(
      authorizations.filter(
        (route) =>
          !route.name.startsWith('organization-') &&
          !route.name.startsWith('people-') &&
          !route.name.startsWith('warehouse-') &&
          !route.name.startsWith('procurement-') &&
          !route.name.startsWith('requisitions-') &&
          !route.name.startsWith('sales-') &&
          route.name !== 'functions-workbench',
      ),
    ).toEqual([
      { name: 'home', authorizedAs: null },
      { name: 'inbox', authorizedAs: null },
      { name: 'position-permissions', authorizedAs: 'position-permissions' },
      { name: 'operations-overview', authorizedAs: 'operations-overview' },
      { name: 'operations-issues', authorizedAs: 'operations-issues' },
      { name: 'operations-targets', authorizedAs: 'operations-targets' },
      { name: 'materials-overview', authorizedAs: 'materials-overview' },
      { name: 'production-overview', authorizedAs: 'production-overview' },
      { name: 'production-daily', authorizedAs: 'production-daily' },
      {
        name: 'production-schedules',
        authorizedAs: 'production-schedules',
      },
      { name: 'production-attendance', authorizedAs: 'production-attendance' },
      {
        name: 'production-shift-reports',
        authorizedAs: 'production-shift-reports',
      },
      { name: 'production-equipment', authorizedAs: 'production-equipment' },
      {
        name: 'production-maintenance-plans',
        authorizedAs: 'production-maintenance-plans',
      },
      { name: 'production-downtime', authorizedAs: 'production-downtime' },
      { name: 'production-overtime', authorizedAs: 'production-overtime' },
      { name: 'production-setup', authorizedAs: 'production-setup' },
      { name: 'assets-list', authorizedAs: 'people-assets' },
      { name: 'hse-overview', authorizedAs: 'hse-overview' },
      { name: 'hse-incidents', authorizedAs: 'hse-incidents' },
      { name: 'hse-hazards', authorizedAs: 'hse-hazards' },
      { name: 'hse-certificates', authorizedAs: 'hse-certificates' },
    ]);
    const materialRoutes = authorizations.filter((route) =>
      route.name.startsWith('warehouse-material'),
    );
    expect(materialRoutes).toHaveLength(72);
    for (const prefix of [
      'procurement-orders',
      'sales-customers',
      'sales-orders',
      'warehouse-inbounds',
      'warehouse-outbounds',
      'warehouse-transfers',
      'warehouse-counts',
      'warehouse-inventory',
    ]) {
      const children = authorizations.filter(
        (route) => route.name === prefix || route.name.startsWith(`${prefix}-`),
      );
      expect(children.length).toBeGreaterThan(1);
      expect(children.every((route) => route.authorizedAs === prefix)).toBe(
        true,
      );
    }
    const supplierRoutes = authorizations.filter((route) =>
      route.name.startsWith('procurement-suppliers'),
    );
    expect(supplierRoutes).toHaveLength(11);
    expect(
      supplierRoutes.every(
        (route) => route.authorizedAs === 'procurement-suppliers',
      ),
    ).toBe(true);
    const requestRoutes = authorizations.filter((route) =>
      route.name.startsWith('procurement-requests'),
    );
    expect(requestRoutes).toHaveLength(15);
    expect(requestRoutes).toContainEqual({
      name: 'procurement-requests-source-action',
      authorizedAs: 'procurement-requests',
    });
    expect(
      requestRoutes.every(
        (route) => route.authorizedAs === 'procurement-requests',
      ),
    ).toBe(true);
    const issueRoutes = authorizations.filter((route) =>
      route.name.startsWith('requisitions-'),
    );
    expect(
      issueRoutes.filter((route) =>
        route.name.startsWith('requisitions-requests'),
      ),
    ).toHaveLength(15);
    expect(issueRoutes).toContainEqual({
      name: 'requisitions-requests-source-action',
      authorizedAs: 'requisitions-requests',
    });
    expect(
      issueRoutes.filter((route) =>
        route.name.startsWith('requisitions-purposes'),
      ),
    ).toHaveLength(5);
    const issueSettings = issueRoutes.filter((route) =>
      route.name.startsWith('requisitions-settings'),
    );
    expect(issueSettings).toEqual([
      {
        name: 'requisitions-settings',
        authorizedAs: 'requisitions-review-settings',
      },
    ]);
    expect(
      authorizations.find((route) => route.name === 'requisitions-overview'),
    ).toEqual({
      name: 'requisitions-overview',
      authorizedAs: 'requisitions-overview',
    });
    for (const [name, authorizedAs] of [
      ['procurement-settings', 'procurement-review-settings'],
      ['sales-settings', 'sales-review-settings'],
      ['sales-settings-edit', 'sales-review-settings'],
      ['warehouse-settings', 'warehouse-review-settings'],
      ['warehouse-settings-edit', 'warehouse-review-settings'],
    ] as const)
      expect(authorizations.find((route) => route.name === name)).toEqual({
        name,
        authorizedAs,
      });
    for (const route of issueRoutes.filter(
      (item) =>
        !item.name.startsWith('requisitions-settings') &&
        item.name !== 'requisitions-overview',
    ))
      expect(route.authorizedAs).toBe(
        route.name.startsWith('requisitions-requests')
          ? 'requisitions-requests'
          : 'requisitions-purposes',
      );
    for (const route of materialRoutes)
      expect(route.authorizedAs).toMatch(/^warehouse-material/);
    expect(
      authorizations.find((route) => route.name === 'functions-workbench'),
    ).toEqual({ name: 'functions-workbench', authorizedAs: null });
    const peopleRoutes = authorizations.filter((route) =>
      route.name.startsWith('people-'),
    );
    expect(peopleRoutes.map((route) => route.name)).toEqual(
      expect.arrayContaining([
        'people-overview',
        'people-employees',
        'people-profiles',
        'people-dimensions',
        'people-models',
        'people-evaluations',
        'people-developmentPlans',
        'people-workforcePlans',
        'people-history',
      ]),
    );
    for (const route of peopleRoutes)
      expect(route.authorizedAs).toMatch(/^people-/);
    const organizationRoutes = authorizations.filter((route) =>
      route.name.startsWith('organization-'),
    );
    expect(organizationRoutes).toHaveLength(32);
    expect(
      organizationRoutes.every(
        (route) => route.authorizedAs === 'settings:organization',
      ),
    ).toBe(true);
  });

  it('keeps the inbox out of the application navigation', () => {
    // The inbox is reached from the header's inbox button, so it deliberately declares no menu entry.
    expect(
      applicationRoutes[0].routes.find((route) => route.name === 'inbox'),
    ).not.toHaveProperty('navigation');
  });

  it('places the material center beside warehouse management and preserves existing links and grants', () => {
    const functions = resolveRoutes().routes.find(
      (route) => route.name === 'functions',
    );
    const center = functions?.children?.find(
      (route) => route.navigation?.title === 'materials.center',
    );
    const warehouse = functions?.children?.find(
      (route) => route.name === 'warehouse',
    );
    expect(center).toBeDefined();
    expect(
      center?.children?.some((route) => route.name.includes('categories')),
    ).toBe(false);
    expect(warehouse?.children?.map((route) => route.name)).toEqual([
      'warehouse-overview',
      'warehouse-inbounds',
      'warehouse-outbounds',
      'warehouse-transfers',
      'warehouse-counts',
      'warehouse-inventory',
      'warehouse-settings',
      'warehouse-settings-edit',
      'warehouse-material-warehouses',
    ]);
    expect(center?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'warehouse-materials',
          path: '/functions/warehouse/materials',
          authz: {
            resource: { type: 'page', id: 'warehouse-materials' },
            action: 'access',
          },
        }),
        expect.objectContaining({
          name: 'warehouse-material-history',
          path: '/functions/warehouse/materials/history',
        }),
      ]),
    );
  });
});

/** This application's own contribution, registered the way the client runtime registers it. */
function resolveRoutes() {
  return resolveAppClientContributions([
    {
      packageName: '@nocobase/app-template-default',
      routes: applicationRoutes,
      source: 'application',
    },
  ]);
}

/**
 * The paths of the pages a route tree registers. A menu group names no component, so it carries no path of its own
 * and inherits its parent's — filtering on `componentLoader` is what keeps that inherited path out of the list.
 */
function pagePaths(routes: readonly AppClientRegisteredRoute[]): string[] {
  return routes.flatMap((route) => [
    ...(route.componentLoader ? [route.path] : []),
    ...pagePaths(route.children ?? []),
  ]);
}

/** Every page loader in a tree, at any depth. */
function componentLoadersIn(
  routes: readonly AppClientRegisteredRoute[],
): AppClientRouteComponentLoader[] {
  return routes.flatMap((route) => [
    ...(route.componentLoader ? [route.componentLoader] : []),
    ...componentLoadersIn(route.children ?? []),
  ]);
}

/** Page authorization comes directly from the registered tree. */
function pageAuthorizations(
  routes: readonly AppClientRegisteredRoute[],
): { name: string; authorizedAs: string | null }[] {
  return routes.flatMap((route) => [
    ...(route.componentLoader && route.auth === 'required'
      ? [
          {
            name: route.name,
            authorizedAs:
              route.authz === 'skip'
                ? null
                : route.authz === 'unrestricted'
                  ? 'unrestricted'
                  : route.authz.resource.type === 'page'
                    ? route.authz.resource.id
                    : `${route.authz.resource.type}:${route.authz.resource.id}`,
          },
        ]
      : []),
    ...pageAuthorizations(route.children ?? []),
  ]);
}

import { defineMigration } from '@nocobase/db';

export const MODULE_DASHBOARDS = [
  {
    page: 'people-personnel-overview',
    anchors: [
      'people-employees',
      'people-employments',
      'people-assignments',
      'people-changes',
    ],
  },
  {
    page: 'materials-overview',
    anchors: ['warehouse-materials'],
  },
  {
    page: 'warehouse-overview',
    anchors: ['warehouse-inbounds', 'warehouse-outbounds'],
  },
  {
    page: 'procurement-overview',
    anchors: ['procurement-requests'],
  },
  {
    page: 'sales-overview',
    anchors: ['sales-orders'],
  },
  {
    page: 'requisitions-overview',
    anchors: ['requisitions-requests'],
  },
  {
    page: 'production-overview',
    anchors: [
      'production-daily',
      'production-schedules',
      'production-attendance',
      'production-shift-reports',
      'production-equipment',
      'production-maintenance-plans',
      'production-downtime',
      'production-overtime',
      'production-setup',
    ],
  },
] as const;

type Grant = {
  resource?: { type?: string; id?: string };
  actions?: { action: string }[];
};

function decode(grants: unknown): Grant[] {
  return typeof grants === 'string'
    ? (JSON.parse(grants) as Grant[])
    : structuredClone(grants as Grant[]);
}

function encode(original: unknown, grants: Grant[]): string | Grant[] {
  return typeof original === 'string' ? JSON.stringify(grants) : grants;
}

/**
 * Grant each module dashboard to the roles that already reach that module's
 * primary data pages. Roles that only reach secondary resources (inventory,
 * suppliers, customers, requisition purposes) keep their existing menus; their
 * module dashboard would need a company list they cannot read.
 */
export function withDashboardGrants(grants: Grant[]): Grant[] {
  const ids = new Set(
    grants
      .filter((grant) => grant.resource?.type === 'page')
      .map((grant) => grant.resource?.id ?? ''),
  );
  const additions: Grant[] = [];
  for (const dashboard of MODULE_DASHBOARDS) {
    if (ids.has(dashboard.page)) continue;
    if (!dashboard.anchors.some((anchor) => ids.has(anchor))) continue;
    additions.push({
      resource: { type: 'page', id: dashboard.page },
      actions: [{ action: 'access' }],
    });
  }
  return additions.length ? [...grants, ...additions] : grants;
}

export default defineMigration({
  name: '202611010011_module_dashboard_pages',
  transaction: true,
  async up(context) {
    const sets = context.repository('authorizationPermissionSets');
    const rows = await sets.findMany();
    for (const row of rows) {
      const current = decode(row.grants);
      const next = withDashboardGrants(current);
      if (next === current) continue;
      await sets.updateOne({
        filter: { key: row.key as string },
        values: { grants: encode(row.grants, next), updatedAt: new Date() },
      });
    }
  },
  async down(context) {
    const sets = context.repository('authorizationPermissionSets');
    const rows = await sets.findMany();
    const pages = new Set<string>(
      MODULE_DASHBOARDS.map((dashboard) => dashboard.page),
    );
    for (const row of rows) {
      const current = decode(row.grants);
      if (
        !current.some(
          (grant) =>
            grant.resource?.type === 'page' &&
            pages.has(grant.resource.id ?? ''),
        )
      )
        continue;
      await sets.updateOne({
        filter: { key: row.key as string },
        values: {
          grants: encode(
            row.grants,
            current.filter(
              (grant) =>
                !(
                  grant.resource?.type === 'page' &&
                  pages.has(grant.resource.id ?? '')
                ),
            ),
          ),
          updatedAt: new Date(),
        },
      });
    }
  },
});

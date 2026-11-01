import { defineSeed, type SeedContext } from '@nocobase/db';

export const MODULE_DASHBOARD_ANCHORS = [
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

/** Fresh installs seed permission sets after the module pages exist. */
export function withSeedDashboardGrants(grants: Grant[]): Grant[] {
  const ids = new Set(
    grants
      .filter((grant) => grant.resource?.type === 'page')
      .map((grant) => grant.resource?.id ?? ''),
  );
  const additions: Grant[] = [];
  for (const dashboard of MODULE_DASHBOARD_ANCHORS) {
    if (ids.has(dashboard.page)) continue;
    if (!dashboard.anchors.some((anchor) => ids.has(anchor))) continue;
    additions.push({
      resource: { type: 'page', id: dashboard.page },
      actions: [{ action: 'access' }],
    });
  }
  return additions.length ? [...grants, ...additions] : grants;
}

export default defineSeed({
  name: '202611010011_module_dashboard_pages',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    const sets = repository('authorizationPermissionSets');
    const rows = await sets.findMany();
    for (const row of rows) {
      const grants = (
        typeof row.grants === 'string'
          ? JSON.parse(row.grants)
          : structuredClone(row.grants)
      ) as Grant[];
      const next = withSeedDashboardGrants(grants);
      if (next === grants) continue;
      await sets.updateOne({
        filter: { key: row.key as string },
        values: {
          grants:
            typeof row.grants === 'string' ? JSON.stringify(next) : next,
          updatedAt: new Date(),
        },
      });
    }
  },
});

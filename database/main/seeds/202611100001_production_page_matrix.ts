import { defineSeed, type SeedContext } from '@nocobase/db';

/**
 * Runs after every production feature seed and keeps the nine production pages
 * aligned with the role that owns them. Migrations already fixed existing
 * installations; this seed makes a fresh install start from the same matrix
 * instead of every set owning every page.
 */
const PAGES = {
  'production-manager': [
    'production-overview',
    'production-report',
    'production-schedules',
    'production-shift-reports',
    'production-downtime',
    'production-overtime',
    'production-equipment',
    'production-maintenance-plans',
    'production-setup',
  ],
  'production-lead': ['production-overview', 'production-report'],
  'production-group-viewer': [
    'production-overview',
    'production-report',
    'production-schedules',
    'production-shift-reports',
    'production-downtime',
    'production-overtime',
  ],
  'production-system-admin': [
    'production-overview',
    'production-report',
    'production-schedules',
    'production-shift-reports',
    'production-downtime',
    'production-overtime',
    'production-equipment',
    'production-maintenance-plans',
    'production-setup',
  ],
} as const;

type Grant = {
  resource?: { type?: string; id?: string };
  actions?: { action: string }[];
};

const ALL_PAGES = [...new Set(Object.values(PAGES).flat())];

function decode(grants: unknown): Grant[] {
  return typeof grants === 'string'
    ? (JSON.parse(grants) as Grant[])
    : structuredClone(grants as Grant[]);
}

function encode(original: unknown, grants: Grant[]): string | Grant[] {
  return typeof original === 'string' ? JSON.stringify(grants) : grants;
}

export function withProductionPages(
  grants: Grant[],
  pages: readonly string[],
): Grant[] {
  const managed = new Set<string>(ALL_PAGES);
  const kept = grants.filter(
    (grant) =>
      !(grant.resource?.type === 'page' && managed.has(grant.resource.id ?? '')),
  );
  const keptIds = new Set(
    kept
      .filter((grant) => grant.resource?.type === 'page')
      .map((grant) => grant.resource?.id ?? ''),
  );
  return [
    ...kept,
    ...pages
      .filter((page) => !keptIds.has(page))
      .map((page) => ({
        resource: { type: 'page' as const, id: page },
        actions: [{ action: 'access' }],
      })),
  ];
}

export default defineSeed({
  name: '202611100001_production_page_matrix',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    for (const [key, pages] of Object.entries(PAGES)) {
      const row = await repository('authorizationPermissionSets').findOne({
        filter: { key },
      });
      if (!row) continue;
      const current = decode(row.grants);
      const next = withProductionPages(current, pages);
      if (JSON.stringify(current) === JSON.stringify(next)) continue;
      await repository('authorizationPermissionSets').updateOne({
        filter: { key },
        values: { grants: encode(row.grants, next), updatedAt: new Date() },
      });
    }
  },
});

import { defineMigration } from '@nocobase/db';

const LEGACY_PAGE = 'review-settings';

export const MODULE_REVIEW_PAGES = [
  {
    legacy: 'procurement-settings',
    page: 'procurement-review-settings',
  },
  {
    legacy: 'requisitions-settings',
    page: 'requisitions-review-settings',
  },
  { legacy: 'sales-settings', page: 'sales-review-settings' },
  { legacy: 'warehouse-settings', page: 'warehouse-review-settings' },
] as const;

type Grant = {
  resource?: { type?: string; id?: string };
  actions?: { action: string }[];
};

function pageIds(grants: Grant[]): Set<string> {
  return new Set(
    grants
      .filter((grant) => grant.resource?.type === 'page')
      .map((grant) => grant.resource?.id ?? '')
      .filter(Boolean),
  );
}

/**
 * Split the shared review page into four module pages.
 *
 * A role that still has the old per-module page keeps only that module.
 * A role that only has the former shared page gets all four, because there
 * is no old per-module information to narrow it down.
 */
export function withModuleReviewGrants(grants: Grant[]): Grant[] {
  const ids = pageIds(grants),
    legacy = ids.has(LEGACY_PAGE),
    additions: Grant[] = [];
  for (const module of MODULE_REVIEW_PAGES) {
    if (ids.has(module.page)) continue;
    if (ids.has(module.legacy) || (legacy && !hasLegacyModule(ids)))
      additions.push({
        resource: { type: 'page', id: module.page },
        actions: [{ action: 'access' }],
      });
  }
  return additions.length ? [...grants, ...additions] : grants;
}

function hasLegacyModule(ids: Set<string>): boolean {
  return MODULE_REVIEW_PAGES.some((module) => ids.has(module.legacy));
}

function decode(grants: unknown): Grant[] {
  return typeof grants === 'string'
    ? (JSON.parse(grants) as Grant[])
    : structuredClone(grants as Grant[]);
}

function encode(original: unknown, grants: Grant[]): string | Grant[] {
  return typeof original === 'string' ? JSON.stringify(grants) : grants;
}

export default defineMigration({
  name: '202611010009_module_review_settings_pages',
  transaction: true,
  async up(context) {
    const sets = context.repository('authorizationPermissionSets'),
      rows = await sets.findMany();
    for (const row of rows) {
      const current = decode(row.grants),
        next = withModuleReviewGrants(current);
      if (next === current) continue;
      await sets.updateOne({
        filter: { key: row.key as string },
        values: { grants: encode(row.grants, next), updatedAt: new Date() },
      });
    }
  },
  async down(context) {
    const sets = context.repository('authorizationPermissionSets'),
      rows = await sets.findMany();
    for (const row of rows) {
      const current = decode(row.grants);
      if (
        !current.some(
          (grant) =>
            grant.resource?.type === 'page' &&
            MODULE_REVIEW_PAGES.some(
              (module) => grant.resource?.id === module.page,
            ),
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
                !MODULE_REVIEW_PAGES.some(
                  (module) => grant.resource?.id === module.page,
                ),
            ),
          ),
          updatedAt: new Date(),
        },
      });
    }
  },
});

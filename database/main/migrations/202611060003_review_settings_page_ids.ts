import { defineMigration } from '@nocobase/db';

/**
 * 复核设置的四个页面在路由里用的是 `*-review-settings`。
 * 早先的种子把权限集里的页面写成 `*-settings`，导致全新安装的库里
 * 除 root 之外的权限集都打不开这四个页面（`202611010009` 只在旧库里补过）。
 * 这里再补一次，幂等：已经有新页面标识的权限集跳过。
 */
const PAGES = [
  { legacy: 'procurement-settings', page: 'procurement-review-settings' },
  { legacy: 'requisitions-settings', page: 'requisitions-review-settings' },
  { legacy: 'sales-settings', page: 'sales-review-settings' },
  { legacy: 'warehouse-settings', page: 'warehouse-review-settings' },
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

function pageIds(grants: Grant[]): Set<string> {
  return new Set(
    grants
      .filter((grant) => grant.resource?.type === 'page')
      .map((grant) => grant.resource?.id ?? '')
      .filter(Boolean),
  );
}

export default defineMigration({
  name: '202611060003_review_settings_page_ids',
  transaction: true,
  async up(context) {
    const sets = context.repository('authorizationPermissionSets'),
      rows = await sets.findMany();
    for (const row of rows) {
      const current = decode(row.grants),
        ids = pageIds(current),
        additions: Grant[] = [];
      for (const entry of PAGES) {
        if (ids.has(entry.page) || !ids.has(entry.legacy)) continue;
        additions.push({
          resource: { type: 'page', id: entry.page },
          actions: [{ action: 'access' }],
        });
      }
      if (additions.length === 0) continue;
      await sets.updateOne({
        filter: { key: row.key as string },
        values: {
          grants: encode(row.grants, [...current, ...additions]),
          updatedAt: new Date(),
        },
      });
    }
  },
  async down(context) {
    const sets = context.repository('authorizationPermissionSets'),
      rows = await sets.findMany();
    for (const row of rows) {
      const current = decode(row.grants),
        next = current.filter(
          (grant) =>
            !(
              grant.resource?.type === 'page' &&
              PAGES.some((entry) => entry.page === grant.resource?.id)
            ),
        );
      if (next.length === current.length) continue;
      await sets.updateOne({
        filter: { key: row.key as string },
        values: { grants: encode(row.grants, next), updatedAt: new Date() },
      });
    }
  },
});

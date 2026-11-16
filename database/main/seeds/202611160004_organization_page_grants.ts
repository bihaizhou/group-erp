import { defineSeed, type SeedContext } from '@nocobase/db';

const PAGE_IDS = [
  'organization-overview',
  'organization-subjects',
  'organization-units',
  'organization-positions',
  'organization-sectors',
  'organization-regions',
  'organization-relations',
  'organization-history',
] as const;

/**
 * 组织架构页面从「settings:organization read」拆成独立的页面资源（权限编辑器
 * 才能逐个页面授权）。本种子给已持有 settings:organization 的权限集补上这些
 * 页面入口，避免升级后原有角色进不去组织架构；已经存在的授权不重复追加。
 */
export default defineSeed({
  name: '202611160004_organization_page_grants',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    const sets = repository('authorizationPermissionSets');
    const rows = await sets.findMany({ limit: 1000 });
    for (const row of rows) {
      const grants = (
        Array.isArray(row.grants)
          ? row.grants
          : typeof row.grants === 'string'
            ? JSON.parse(row.grants)
            : []
      ) as { resource?: { type?: string; id?: string }; actions?: unknown }[];
      const org = grants.find(
        (grant) =>
          grant.resource?.type === 'settings' &&
          grant.resource?.id === 'organization',
      );
      if (!org) continue;
      const actions = Array.isArray(org.actions)
        ? (org.actions as { action?: string }[]).map((a) => a.action)
        : [];
      if (!actions.includes('read') && !actions.includes('update')) continue;
      let changed = false;
      for (const id of PAGE_IDS) {
        const exists = grants.some(
          (grant) =>
            grant.resource?.type === 'page' && grant.resource?.id === id,
        );
        if (exists) continue;
        grants.push({
          resource: { type: 'page', id },
          actions: [{ action: 'access' }],
        });
        changed = true;
      }
      if (!changed) continue;
      await sets.updateOne({
        filter: { key: String(row.key ?? '') },
        values: { grants, updatedAt: new Date() },
      });
    }
  },
});

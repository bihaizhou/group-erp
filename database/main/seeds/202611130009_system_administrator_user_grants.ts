import { defineSeed, type SeedContext } from '@nocobase/db';

const KEY = 'system-administrator';

/**
 * User administration grants for the system-administrator role (E5 修复)：
 * 202611110002_system_administrator 只授予了权限集/默认访问管理，没有 user:*
 * 授权，导致该角色打不开 /settings/users。本种子为已存在的
 * system-administrator 权限集增量补上用户管理动作，不改动原种子。
 * UI 未提供 invite/delete 入口，按最小但完整的原则不授予这两项。
 */
export default defineSeed({
  name: '202611130009_system_administrator_user_grants',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    const sets = repository('authorizationPermissionSets');
    const row = await sets.findOne({ filter: { key: KEY } });
    if (!row) return;
    const grants = (
      Array.isArray(row.grants)
        ? row.grants
        : typeof row.grants === 'string'
          ? JSON.parse(row.grants)
          : []
    ) as { resource?: { type?: string; id?: string }; actions?: unknown }[];
    const required = [
      'read',
      'create',
      'update',
      'disable',
      'enable',
      'assign-role',
      'reset-password',
      'revoke-sessions',
    ];
    const userGrant = grants.find(
      (grant) => grant.resource?.type === 'user' && grant.resource?.id === '*',
    );
    const existing = new Set(
      Array.isArray(userGrant?.actions)
        ? (userGrant!.actions as { action?: string }[]).map(
            (action) => action.action,
          )
        : [],
    );
    const missing = required.filter((action) => !existing.has(action));
    if (missing.length === 0) return;
    if (userGrant) {
      userGrant.actions = [
        ...(userGrant.actions as unknown[]),
        ...missing.map((action) => ({ action })),
      ];
    } else {
      grants.push({
        resource: { type: 'user', id: '*' },
        actions: required.map((action) => ({ action })),
      });
    }
    await sets.updateOne({
      filter: { key: KEY },
      values: { grants, updatedAt: new Date() },
    });
  },
});

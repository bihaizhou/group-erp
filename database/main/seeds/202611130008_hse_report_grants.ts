import { defineSeed, type SeedContext } from '@nocobase/db';

const settingsId = 'hse';

/**
 * 安环上报权限（E4 修复）：
 * 方案要求"任何人可报"事件/隐患。POST /incidents 与 /hazards 现为
 * allowedAny(['manage','report'])。本种子为所有已含 settings/hse 授权的
 * 权限集补上 report 动作，使现有安环角色（负责人/审批人/集团只读/系统管理）
 * 都能上报，同时保留"无任何安环权限者不可报"的边界。
 * 注意：readAll 且无 manage 的用户（如集团只读）创建记录时，服务端
 * resolveSubject 会把写入范围收紧到其任职所在公司（无任职则拒绝），
 * 防止只读角色跨公司写入。
 */
export default defineSeed({
  name: '202611130008_hse_report_grants',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    const sets = repository('authorizationPermissionSets');
    const rows = await sets.findMany({});
    for (const row of rows) {
      const grants = (
        Array.isArray(row.grants)
          ? row.grants
          : typeof row.grants === 'string'
            ? JSON.parse(row.grants)
            : []
      ) as {
        resource?: { type?: string; id?: string };
        actions?: { action?: string }[];
      }[];
      const settingsGrant = grants.find(
        (grant) =>
          grant.resource?.type === 'settings' &&
          grant.resource?.id === settingsId,
      );
      if (!settingsGrant) continue;
      const actions = Array.isArray(settingsGrant.actions)
        ? settingsGrant.actions
        : [];
      if (!actions.some((action) => action.action === 'report')) {
        settingsGrant.actions = [...actions, { action: 'report' }];
        await sets.updateOne({
          filter: { key: String(row.key ?? '') },
          values: { grants, updatedAt: new Date() },
        });
      }
    }
  },
});

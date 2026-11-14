import { defineSeed, type SeedContext } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';

const page = 'people-assets';
const settingsId = 'assets';

/**
 * 补齐固定资产报废审批授权（P0 修复）：
 * - asset-system-admin 增加 approve（原有 read/manage/readAll，出厂即无人可批报废单）；
 * - 新建 asset-approver（read + approve，无 manage），用于职责分离的专职审批角色。
 */
export default defineSeed({
  name: '202611130006_asset_scrap_approval_defaults',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    const sets = repository('authorizationPermissionSets');

    const systemAdmin = await sets.findOne({
      filter: { key: 'asset-system-admin' },
    });
    if (systemAdmin) {
      const grants = Array.isArray(systemAdmin.grants)
        ? (systemAdmin.grants as {
            resource?: { type?: string; id?: string };
            actions?: { action?: string }[];
          }[])
        : [];
      const settingsGrant = grants.find(
        (grant) =>
          grant.resource?.type === 'settings' &&
          grant.resource?.id === settingsId,
      );
      if (settingsGrant) {
        const actions = Array.isArray(settingsGrant.actions)
          ? settingsGrant.actions
          : [];
        if (!actions.some((action) => action.action === 'approve')) {
          settingsGrant.actions = [...actions, { action: 'approve' }];
          await sets.updateOne({
            filter: { key: 'asset-system-admin' },
            values: { grants, updatedAt: new Date() },
          });
        }
      }
    }

    if (
      !(await sets.exists({
        filter: { key: 'asset-approver' },
      }))
    ) {
      await sets.createOne({
        values: {
          id: 'asset-approver',
          key: 'asset-approver',
          title: encodeAuthorizationTitle('资产报废审批人'),
          grants: [
            {
              resource: { type: 'page', id: page },
              actions: [{ action: 'access' }],
            },
            {
              resource: { type: 'settings', id: settingsId },
              actions: [{ action: 'read' }, { action: 'approve' }],
            },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
  },
});

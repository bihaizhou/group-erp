import { defineSeed } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';

export default defineSeed({
  name: '202611160003_organization_approver',
  async run({ repository }) {
    if (
      await repository('authorizationPermissionSets').exists({
        filter: { key: 'organization-approver' },
      })
    )
      return;
    await repository('authorizationPermissionSets').createOne({
      values: {
        id: 'organization-approver',
        key: 'organization-approver',
        title: encodeAuthorizationTitle('组织变更审核人'),
        grants: [
          {
            resource: { type: 'settings', id: 'organization' },
            actions: [{ action: 'read' }, { action: 'approve' }],
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  },
});

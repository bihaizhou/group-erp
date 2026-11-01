import { defineSeed } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';

export default defineSeed({
  name: '202610160001_organization_defaults',
  async run({ repository }) {
    if (!(await repository('orgMutationLock').exists({ filter: { id: 'organization' } }))) {
      await repository('orgMutationLock').createOne({ values: { id: 'organization', nonce: 'initial' } });
    }
    for (const [id, code, name, sortOrder] of [
      ['00000000-0000-4000-8000-000000000001', 'DOMESTIC', '国内', 0],
      ['00000000-0000-4000-8000-000000000002', 'OVERSEAS', '海外', 1],
    ] as const) {
      if (await repository('orgRegions').exists({ filter: { code } })) continue;
      await repository('orgRegions').createOne({ values: {
        id, code, name, sortOrder, status: 'active', revision: 1,
        createdAt: new Date('2026-10-16T00:00:00Z'),
        updatedAt: new Date('2026-10-16T00:00:00Z'),
      } });
    }
    for (const [key, title, actions] of [
      ['organization-reader', '组织架构查看', ['read']],
      ['organization-maintainer', '组织架构维护', ['read', 'update']],
    ] as const) {
      if (await repository('authorizationPermissionSets').exists({ filter: { key } })) continue;
      await repository('authorizationPermissionSets').createOne({ values: {
        id: key, key, title: encodeAuthorizationTitle(title),
        grants: [{resource: {type: 'settings', id: 'organization'}, actions: actions.map(action => ({action}))}],
        createdAt: new Date('2026-10-16T00:00:00Z'),
        updatedAt: new Date('2026-10-16T00:00:00Z'),
      } });
    }
  },
});

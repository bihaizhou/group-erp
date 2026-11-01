import { defineSeed, type SeedContext } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';

const page = 'people-assets';

export default defineSeed({
  name: '202611010007_assets_defaults',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    const definitions = [
      {
        key: 'asset-manager',
        title: '资产管理员',
        actions: ['read', 'manage'],
      },
      {
        key: 'asset-group-viewer',
        title: '资产集团只读',
        actions: ['read', 'readAll'],
      },
      {
        key: 'asset-system-admin',
        title: '资产系统管理',
        actions: ['read', 'manage', 'readAll'],
      },
    ];
    for (const definition of definitions) {
      if (
        await repository('authorizationPermissionSets').exists({
          filter: { key: definition.key },
        })
      )
        continue;
      await repository('authorizationPermissionSets').createOne({
        values: {
          id: definition.key,
          key: definition.key,
          title: encodeAuthorizationTitle(definition.title),
          grants: [
            {
              resource: { type: 'page', id: page },
              actions: [{ action: 'access' }],
            },
            {
              resource: { type: 'settings', id: 'assets' },
              actions: definition.actions.map((action) => ({ action })),
            },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
  },
});

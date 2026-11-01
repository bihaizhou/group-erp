import { defineSeed, type SeedContext } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';

const pages = [
  'operations-overview',
  'operations-issues',
  'operations-targets',
].map((id) => ({
  resource: { type: 'page' as const, id },
  actions: [{ action: 'access' }],
}));

export default defineSeed({
  name: '202610250001_operations_defaults',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    const definitions = [
      {
        key: 'operations-project-viewer',
        title: '运营项目查看',
        actions: ['read', 'manage'],
      },
      {
        key: 'operations-group-viewer',
        title: '运营集团查看',
        actions: ['read', 'readAll'],
      },
      {
        key: 'operations-system-admin',
        title: '运营系统管理',
        actions: ['read', 'readAll', 'manage'],
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
            ...pages,
            {
              resource: { type: 'settings', id: 'operations' },
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

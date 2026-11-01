import { defineSeed, type SeedContext } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';

const pages = [
  'production-attendance',
  'production-setup',
  'production-shift-reports',
];

export default defineSeed({
  name: '202610240001_production_defaults',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    const definitions = [
      {
        key: 'production-manager',
        title: '生产负责人',
        actions: ['read', 'manage'],
      },
      {
        key: 'production-lead',
        title: '生产班组长',
        actions: ['read', 'manage'],
      },
      {
        key: 'production-group-viewer',
        title: '生产集团只读',
        actions: ['read', 'readAll'],
      },
      {
        key: 'production-system-admin',
        title: '生产系统管理',
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
            ...pages.map((page) => ({
              resource: { type: 'page' as const, id: page },
              actions: [{ action: 'access' }],
            })),
            {
              resource: { type: 'settings', id: 'production' },
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

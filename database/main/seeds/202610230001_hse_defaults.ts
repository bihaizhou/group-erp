import { defineSeed, type SeedContext } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';

const pages = {
  overview: 'hse-overview',
  incidents: 'hse-incidents',
  hazards: 'hse-hazards',
  certificates: 'hse-certificates',
};

const allPages = Object.values(pages);

export default defineSeed({
  name: '202610230001_hse_defaults',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    const definitions = [
      {
        key: 'hse-project-manager',
        title: '安环项目负责人',
        pages: allPages,
        actions: ['read', 'manage'],
      },
      {
        key: 'hse-project-approver',
        title: '安环项目审批人',
        pages: allPages,
        actions: ['read', 'approve'],
      },
      {
        key: 'hse-group-viewer',
        title: '安环集团只读',
        pages: allPages,
        actions: ['read', 'readAll'],
      },
      {
        key: 'hse-system-admin',
        title: '安环系统管理',
        pages: allPages,
        actions: ['read', 'manage', 'approve', 'readAll'],
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
            ...definition.pages.map((id) => ({
              resource: { type: 'page', id },
              actions: [{ action: 'access' }],
            })),
            {
              resource: { type: 'settings', id: 'hse' },
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

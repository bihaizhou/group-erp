import { defineSeed, type SeedContext } from '@nocobase/db';

const page = 'production-maintenance-plans';
const keys = [
  'production-manager',
  'production-lead',
  'production-group-viewer',
  'production-system-admin',
];

export default defineSeed({
  name: '202610300001_production_maintenance_plans_defaults',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    for (const key of keys) {
      const set = await repository('authorizationPermissionSets').findOne({
        filter: { key },
      });
      if (!set) continue;
      const grants = Array.isArray(set.grants) ? (set.grants as never[]) : [];
      const hasPage = grants.some(
        (grant) =>
          (grant as { resource?: { type?: string; id?: string } }).resource
            ?.type === 'page' &&
          (grant as { resource?: { type?: string; id?: string } }).resource
            ?.id === page,
      );
      if (hasPage) continue;
      await repository('authorizationPermissionSets').updateOne({
        filter: { key },
        values: {
          grants: [
            ...grants,
            {
              resource: { type: 'page', id: page },
              actions: [{ action: 'access' }],
            },
          ],
          updatedAt: new Date(),
        } as never,
      });
    }
  },
});

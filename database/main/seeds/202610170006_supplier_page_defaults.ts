import { defineSeed, type SeedContext } from '@nocobase/db';
export default defineSeed({
  name: '202610170006_supplier_page_defaults',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    for (const key of [
      'procurement-supplier-reader',
      'procurement-supplier-manager',
      'procurement-supplier-master',
      'procurement-supplier-scope-manager',
    ]) {
      const set = await repository('authorizationPermissionSets').findOne({
        filter: { key },
      });
      if (!set) continue;
      const grants = (
        typeof set.grants === 'string'
          ? JSON.parse(set.grants)
          : JSON.parse(JSON.stringify(set.grants))
      ) as Array<{
        resource?: { type?: string; id?: string };
        actions?: Array<{ action: string }>;
      }>;
      // Preserve an explicitly configured page grant (including empty actions).
      if (
        grants.some(
          (v) =>
            v.resource?.type === 'page' &&
            v.resource.id === 'procurement-suppliers',
        )
      )
        continue;
      grants.push({
        resource: { type: 'page', id: 'procurement-suppliers' },
        actions: [{ action: 'access' }],
      });
      await repository('authorizationPermissionSets').updateOne({
        filter: { id: typeof set.id === 'string' ? set.id : '' },
        values: {
          grants:
            typeof set.grants === 'string' ? JSON.stringify(grants) : grants,
          updatedAt: new Date(),
        },
      });
    }
  },
});

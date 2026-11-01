import { defineSeed, type SeedContext } from '@nocobase/db';

type Action = {
  action: string;
  policy?: { type: string; scopes?: Record<string, unknown> };
  [key: string]: unknown;
};
type Grant = {
  resource: { type: string; id: string };
  actions: Action[];
  [key: string]: unknown;
};

export default defineSeed({
  name: '202610170003_remove_material_category_grants',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    const sets = await repository('authorizationPermissionSets').findMany({});
    for (const set of sets) {
      if (typeof set.id !== 'string')
        throw new Error('Permission set ID must be a string.');
      const before = (
        typeof set.grants === 'string' ? JSON.parse(set.grants) : set.grants
      ) as Grant[];
      // Platform-owned permission sets may use a non-list grants envelope.
      if (!Array.isArray(before)) continue;
      const grants = structuredClone(before).filter(
        ({ resource }) =>
          !(
            (resource.type === 'page' &&
              resource.id === 'warehouse-material-categories') ||
            (resource.type === 'composite' &&
              resource.id === 'materials.categories') ||
            (resource.type === 'database.collection' &&
              resource.id === 'materialCategories')
          ),
      );
      for (const grant of grants) {
        if (
          grant.resource.type !== 'composite' ||
          !(
            grant.resource.id.startsWith('materials.') ||
            ['procurement.materials', 'requisitions.materials'].includes(
              grant.resource.id,
            )
          )
        )
          continue;
        for (const action of grant.actions) {
          const scopes = action.policy?.scopes;
          if (!scopes) continue;
          delete scopes.categories;
          delete scopes.materialCategories;
          if (grant.resource.id === 'materials.skus') {
            scopes.tags ??= 'allRecords';
            scopes.tagLinks ??= 'allRecords';
          }
        }
      }
      if (JSON.stringify(before) !== JSON.stringify(grants))
        await repository('authorizationPermissionSets').updateOne({
          filter: { id: set.id },
          values: {
            grants:
              typeof set.grants === 'string' ? JSON.stringify(grants) : grants,
            updatedAt: new Date(),
          },
        });
    }
    // Keep assignments, custom scopes and unrelated administrator edits intact.
  },
});

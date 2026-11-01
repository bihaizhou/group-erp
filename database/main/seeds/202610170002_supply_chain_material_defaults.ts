import { defineSeed, type SeedContext } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';

// An immutable initialization snapshot; no imports from evolving resources.
const catalogTables = [
  'materialAttributeTemplates',
  'materialSkus',
  'materialNames',
  'materialCategories',
  'measureUnits',
  'materialUnitRules',
  'materialReferences',
  'materialTags',
  'materialTagLinks',
];

export default defineSeed({
  name: '202610170002_supply_chain_material_defaults',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    for (const [module, title] of [
      ['procurement', '本公司采购选料使用者'],
      ['requisitions', '本公司领用选料使用者'],
    ] as const) {
      const key = `${module}-material-selector`;
      if (
        await repository('authorizationPermissionSets').exists({
          filter: { key },
        })
      )
        continue;
      await repository('authorizationPermissionSets').createOne({
        values: {
          id: key,
          key,
          title: encodeAuthorizationTitle(title),
          grants: [
            {
              resource: { type: 'composite', id: `${module}.materials` },
              actions: [
                {
                  action: 'read',
                  policy: {
                    type: 'composite',
                    scopes: {
                      ...Object.fromEntries(
                        catalogTables.map((table) => [table, 'allRecords']),
                      ),
                      orgSubjects: 'supplyChain.ownSubject',
                      materialSubjectSettings: 'supplyChain.ownCompany',
                    },
                  },
                },
              ],
            },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    // No business samples, live user assignments or page grants for future pages.
  },
});

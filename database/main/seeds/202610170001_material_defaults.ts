import { defineSeed } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
// Seed roles are an initial snapshot; do not depend on runtime application modules.
const materialKinds = [
  'categories',
  'names',
  'templates',
  'skus',
  'units',
  'unitRules',
  'references',
  'tags',
  'tagLinks',
  'requests',
  'subjectSettings',
  'warehouses',
] as const;
const materialDependencies: Record<(typeof materialKinds)[number], string[]> = {
  categories: ['categories'],
  names: ['categories', 'templates'],
  templates: [],
  skus: ['names', 'categories', 'templates', 'units', 'requests', 'references'],
  units: [],
  unitRules: ['skus', 'units'],
  references: ['names', 'skus'],
  tags: [],
  tagLinks: ['tags', 'names', 'skus'],
  requests: ['skus', 'names', 'templates', 'units'],
  subjectSettings: ['skus'],
  warehouses: [],
};

export default defineSeed({
  name: '202610170001_material_defaults',
  transaction: true,
  async run({ repository }) {
    if (
      !(await repository('materialMutationLock').exists({
        filter: { id: 'materials' },
      }))
    )
      await repository('materialMutationLock').createOne({
        values: { id: 'materials', nonce: 'initial' },
      });
    const units = [
      ['EA', '个', 'count', 0],
      ['PCS', '件', 'count', 0],
      ['PEN', '支', 'count', 0],
      ['KG', '千克', 'mass', 3],
      ['T', '吨', 'mass', 6],
      ['M', '米', 'length', 3],
      ['M2', '平方米', 'area', 3],
      ['M3', '立方米', 'volume', 3],
      ['BOX', '盒', 'package', 0],
      ['CASE', '箱', 'package', 0],
      ['PACK', '包', 'package', 0],
    ] as const;
    for (const [index, [code, name, unitType, precision]] of units.entries()) {
      if (await repository('measureUnits').exists({ filter: { code } }))
        continue;
      await repository('measureUnits').createOne({
        values: {
          id: `00000000-0000-4000-8100-${String(index + 1).padStart(12, '0')}`,
          code,
          name,
          unitType,
          precision,
          notes: '',
          status: 'active',
          revision: 1,
          lifecycleVersion: 0,
          statusChangedAt: new Date(),
          createdBy: 'system',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
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
    const catalogGrant = {
      resource: { type: 'composite', id: 'materials.catalog' },
      actions: [
        {
          action: 'read',
          policy: {
            type: 'composite',
            scopes: Object.fromEntries(
              catalogTables.map((table) => [table, 'allRecords']),
            ),
          },
        },
      ],
    };
    const page = (kind: string) => ({
      resource: {
        type: 'page',
        id:
          kind === 'skus'
            ? 'warehouse-materials'
            : `warehouse-material-${kind}`,
      },
      actions: [{ action: 'access' }],
    });
    const roles = [
      {
        key: 'materials-reader',
        title: '物料查询使用者',
        kinds: [] as string[],
        actions: ['read'],
      },
      {
        key: 'materials-requester',
        title: '物料需求提报者',
        kinds: ['requests'],
        actions: ['read', 'update'],
      },
      {
        key: 'materials-maintainer',
        title: '物料维护人员',
        kinds: materialKinds.filter((kind) => kind !== 'warehouses'),
        actions: ['read', 'update'],
      },
      {
        key: 'materials-reviewer',
        title: '物料审核人员',
        kinds: materialKinds.filter((kind) => kind !== 'warehouses'),
        actions: ['read', 'review'],
      },
      {
        key: 'warehouse-master-maintainer',
        title: '本公司仓库基础维护',
        kinds: ['warehouses'],
        actions: ['read', 'update'],
      },
    ];
    for (const role of roles) {
      if (
        await repository('authorizationPermissionSets').exists({
          filter: { key: role.key },
        })
      )
        continue;
      const grants: unknown[] = [page('skus'), catalogGrant];
      for (const name of role.kinds) {
        const kind = name as (typeof materialKinds)[number];
        const org =
          kind === 'warehouses'
            ? ['orgSubjects', 'orgUnits', 'orgPositions']
            : ['requests', 'references', 'subjectSettings'].includes(kind)
              ? ['orgSubjects']
              : [];
        const keys = [
          ...new Set([kind, ...materialDependencies[kind], ...org]),
        ];
        grants.push(page(kind), {
          resource: { type: 'composite', id: `materials.${kind}` },
          actions: role.actions.map((action) => ({
            action,
            policy: {
              type: 'composite',
              scopes: Object.fromEntries(
                keys.map((key) => [
                  key,
                  role.key === 'materials-requester' && key === 'requests'
                    ? 'materials.ownRequests'
                    : [
                          'materials-requester',
                          'warehouse-master-maintainer',
                        ].includes(role.key) && key === 'orgSubjects'
                      ? 'materials.ownSubject'
                      : role.key === 'warehouse-master-maintainer' &&
                          ['warehouses', 'orgUnits'].includes(key)
                        ? 'materials.ownCompany'
                        : 'allRecords',
                ]),
              ),
            },
          })),
        });
      }
      if (['materials-maintainer', 'materials-reviewer'].includes(role.key))
        grants.push(page('history'), {
          resource: { type: 'composite', id: 'materials.history' },
          actions: [
            {
              action: 'read',
              policy: { type: 'composite', scopes: { history: 'allRecords' } },
            },
          ],
        });
      await repository('authorizationPermissionSets').createOne({
        values: {
          id: role.key,
          key: role.key,
          title: encodeAuthorizationTitle(role.title),
          grants,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    // Required unit dictionary and editable role templates only; no companies, SKUs or user assignments.
  },
});

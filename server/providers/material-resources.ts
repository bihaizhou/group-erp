import {
  defineRecordAccess,
  type CompositeResource,
} from '@nocobase/authorization/core';
import {
  condition,
  defineDatabasePermission,
} from '@nocobase/app-plugin-authorization/server';
import type { DatabaseManager } from '@nocobase/db';
import { currentCompanyForUser } from './company-identity.js';
import {
  materialKinds,
  materialTables,
  materialColumns,
  materialBaseColumns,
  materialDependencies,
} from './material-model.js';

export const materialOrgColumns = {
  orgSubjects: ['id', 'code', 'name', 'status'],
  orgUnits: ['id', 'name', 'subjectId', 'status'],
  orgPositions: ['id', 'code', 'name', 'unitId', 'status'],
};
export const materialAuditColumns = [
  'id',
  'kind',
  'recordId',
  'recordName',
  'subjectId',
  'actorId',
  'actorName',
  'operation',
  'reason',
  'beforeValue',
  'afterValue',
  'createdAt',
];
const title = (key: string) => ({ key: `materials.${key}`, ns: 'group-erp' });
export const materialResources = Object.fromEntries(
  materialKinds.map((kind) => [
    kind,
    {
      name: `materials.${kind}`,
      title: title(`kinds.${kind}`),
      actions: ['read', 'update', 'review'].map((action) => {
        const parts = [...new Set([kind, ...materialDependencies[kind]])].map(
          (dependency) => {
            const columns =
              dependency === kind
                ? [...materialBaseColumns, ...materialColumns[dependency]]
                : [
                    'id',
                    'code',
                    'name',
                    'status',
                    ...materialColumns[dependency].filter(
                      (key) =>
                        ![
                          'specification',
                          'usage',
                          'proposedUnit',
                          'resolvedSkuId',
                          'identityKey',
                          'searchText',
                        ].includes(key),
                    ),
                  ];
            const grant = defineDatabasePermission((p) =>
              p.collection(materialTables[dependency]).read(columns),
            );
            return (
              dependency === kind && action !== 'read'
                ? grant.create('*').update('*')
                : grant
            )
              .bind(dependency)
              .build();
          },
        );
        for (const [table, columns] of Object.entries(
          materialOrgColumns,
        ).filter(
          ([table]) =>
            kind === 'warehouses' ||
            (['requests', 'references', 'subjectSettings'].includes(kind) &&
              table === 'orgSubjects'),
        ))
          parts.push(
            defineDatabasePermission((p) => p.collection(table).read(columns))
              .bind(table)
              .build(),
          );
        return {
          name: action,
          title: title(`actions.${action}`),
          grants: parts.flatMap((p) => p.grants),
          dataScopes: parts.flatMap((p) => p.dataScopes ?? []),
        };
      }),
    },
  ]),
) as unknown as Record<(typeof materialKinds)[number], CompositeResource>;

export const materialCatalogColumns: Record<string, string[]> = {
  materialAttributeTemplates: ['id', 'fields', 'status'],
  materialSkus: [
    'id',
    'code',
    'name',
    'materialNameId',
    'baseUnitId',
    'managementMode',
    'attributeValues',
    'searchText',
    'status',
    'revision',
    'createdAt',
    'updatedAt',
  ],
  materialNames: ['id', 'code', 'name', 'templateId', 'status'],
  measureUnits: ['id', 'name', 'unitType', 'precision', 'status'],
  materialUnitRules: [
    'id',
    'name',
    'skuId',
    'unitId',
    'numerator',
    'denominator',
    'conversionMode',
    'variancePercent',
    'status',
    'revision',
  ],
  materialReferences: [
    'id',
    'name',
    'targetKind',
    'targetId',
    'searchKey',
    'subjectId',
    'status',
  ],
  materialTags: ['id', 'name', 'appliesTo', 'status'],
  materialTagLinks: ['id', 'name', 'tagId', 'targetKind', 'targetId', 'status'],
};
const catalogParts = Object.entries(materialCatalogColumns).map(
  ([table, columns]) =>
    defineDatabasePermission((p) => p.collection(table).read(columns))
      .bind(table)
      .build(),
);
const history = defineDatabasePermission((p) =>
  p.collection('materialAudit').read(materialAuditColumns),
)
  .bind('history')
  .build();
export const materialCatalogResource: CompositeResource = {
  name: 'materials.catalog',
  title: title('catalog'),
  actions: [
    {
      name: 'read',
      title: title('actions.read'),
      grants: catalogParts.flatMap((p) => p.grants),
      dataScopes: catalogParts.flatMap((p) => p.dataScopes ?? []),
    },
  ],
};
export const materialHistoryResource: CompositeResource = {
  name: 'materials.history',
  title: title('history'),
  actions: [
    {
      name: 'read',
      title: title('actions.read'),
      grants: history.grants,
      dataScopes: history.dataScopes,
    },
  ],
};

export const materialOwnRequests = defineRecordAccess(
  'materials.ownRequests',
  (a) =>
    a
      .title(title('scopeOwn'))
      .collections('materialRequests')
      .resolver(({ principal }) =>
        principal.type === 'user'
          ? condition('createdBy', '$eq', principal.id)
          : false,
      ),
);
export const materialCompanyAccess = defineRecordAccess(
  'materials.companies',
  (a) =>
    a
      .title(title('scopeCompanies'))
      .collections(
        'materialRequests',
        'materialRequestSources',
        'materialSubjectSettings',
        'warehouses',
        'materialAudit',
      )
      .params<{ subjectIds: string[] }>({
        type: 'object',
        properties: {
          subjectIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['subjectIds'],
      })
      .resolver(({ params }) =>
        Array.isArray(params?.subjectIds) &&
        params.subjectIds.length > 0 &&
        params.subjectIds.length <= 500
          ? {
              kind: 'group',
              logic: 'or',
              items: params.subjectIds.map((id) =>
                condition('subjectId', '$eq', id),
              ),
            }
          : false,
      ),
);

export function materialOwnCompanyAccess(
  database: DatabaseManager,
  timeZone: string,
) {
  const currentSubject = (principal: { type: string; id: string }) =>
    currentCompanyForUser(database, timeZone, principal);
  return [
    defineRecordAccess('materials.ownCompany', (a) =>
      a
        .title(title('scopeCompany'))
        .collections(
          'materialRequests',
          'materialRequestSources',
          'materialSubjectSettings',
          'warehouses',
          'materialAudit',
          'orgUnits',
        )
        .resolver(async ({ principal }) => {
          const subject = await currentSubject(principal);
          return subject ? condition('subjectId', '$eq', subject) : false;
        }),
    ),
    defineRecordAccess('materials.ownSubject', (a) =>
      a
        .title(title('scopeCompany'))
        .collections('orgSubjects')
        .resolver(async ({ principal }) => {
          const subject = await currentSubject(principal);
          return subject ? condition('id', '$eq', subject) : false;
        }),
    ),
  ];
}

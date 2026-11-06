import {
  defineRecordAccess,
  type CompositeResource,
} from '@nocobase/authorization/core';
import {
  condition,
  defineDatabasePermission,
} from '@nocobase/app-plugin-authorization/server';
import type { DatabaseManager } from '@nocobase/db';
import { currentCompaniesForUser } from './purchase-identity.js';
import { materialCatalogColumns } from './material-resources.js';
import { supplyChainModules } from './supply-chain-model.js';

const title = (key: string) => ({ key: `supplyChain.${key}`, ns: 'group-erp' });
export const businessMaterialColumns: Record<string, string[]> = {
  ...materialCatalogColumns,
  orgSubjects: ['id', 'name', 'status'],
  materialSubjectSettings: [
    'id',
    'subjectId',
    'skuId',
    'status',
    'canPurchase',
    'revision',
  ],
};
const permissions = Object.entries(businessMaterialColumns).map(
  ([table, columns]) =>
    defineDatabasePermission((p) => p.collection(table).read(columns))
      .bind(table)
      .build(),
);
export const businessMaterialResources: CompositeResource[] =
  supplyChainModules.map((module) => ({
    name: `${module}.materials`,
    title: title(module),
    actions: [
      {
        name: 'read',
        title: title('selectMaterials'),
        grants: permissions.flatMap((p) => p.grants),
        dataScopes: permissions.flatMap((p) => p.dataScopes ?? []),
      },
    ],
  }));

export const supplyChainCompanyAccess = ['settings', 'subjects'].map((kind) =>
  defineRecordAccess(
    `supplyChain.${kind === 'subjects' ? 'subjects' : 'companies'}`,
    (a) =>
      a
        .title(title('selectedCompanies'))
        .collections(
          kind === 'subjects' ? 'orgSubjects' : 'materialSubjectSettings',
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
                  condition(
                    kind === 'subjects' ? 'id' : 'subjectId',
                    '$eq',
                    id,
                  ),
                ),
              }
            : false,
        ),
  ),
);

export function supplyChainOwnCompanyAccess(
  database: DatabaseManager,
  timeZone: string,
) {
  return ['settings', 'subjects'].map((kind) =>
    defineRecordAccess(
      `supplyChain.${kind === 'subjects' ? 'ownSubject' : 'ownCompany'}`,
      (a) =>
        a
          .title(title('ownCompany'))
          .collections(
            kind === 'subjects' ? 'orgSubjects' : 'materialSubjectSettings',
          )
          .resolver(async ({ principal }) => {
            const companies = await currentCompaniesForUser(
              database,
              timeZone,
              principal,
            );
            if (!companies.length) return false;
            const items = companies.map((company) =>
              condition(
                kind === 'subjects' ? 'id' : 'subjectId',
                '$eq',
                company,
              ),
            );
            return items.length === 1
              ? items[0]
              : { kind: 'group', logic: 'or', items };
          }),
    ),
  );
}

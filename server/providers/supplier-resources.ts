import {
  defineDatabasePermission,
  condition,
} from '@nocobase/app-plugin-authorization/server';
import {
  defineRecordAccess,
  type CompositeResource,
} from '@nocobase/authorization/core';
import type { DatabaseManager } from '@nocobase/db';
import { currentCompanyForUser } from './company-identity.js';
import {
  supplierIdentityColumns,
  supplierSettingColumns,
  supplierAuditColumns,
} from './supplier-model.js';
import {
  partnerPolicyColumns,
  partnerScopeColumns,
} from './partner-applicability.js';

export const supplierActions = [
  'read',
  'create',
  'updateRelationship',
  'updateIdentity',
  'linkIdentity',
  'configureApplicability',
  'addRole',
] as const;
export type SupplierAction = (typeof supplierActions)[number];
const title = (key: string) => ({ key: `procurement.${key}`, ns: 'group-erp' });
export const supplierResource: CompositeResource = {
  name: 'procurement.suppliers',
  title: title('suppliers'),
  actions: supplierActions.map((action) => {
    const parts = Object.entries({
      businessPartners: supplierIdentityColumns,
      partnerSubjectSettings: supplierSettingColumns,
      supplyChainAudit: supplierAuditColumns,
      orgSubjects: ['id', 'code', 'name', 'status', 'type', 'regionId'],
      orgRegions: ['id', 'code', 'name', 'status', 'parentId'],
      partnerRolePolicies: partnerPolicyColumns,
      ...partnerScopeColumns,
    }).map(([table, columns]) => {
      let permission = defineDatabasePermission((p) =>
        p.collection(table).read(columns),
      );
      if (table === 'businessPartners' && action === 'create')
        permission = permission.create(supplierIdentityColumns);
      if (table === 'businessPartners' && action === 'updateIdentity')
        permission = permission.update([
          'code',
          'name',
          'registrationCode',
          'status',
        ]);
      if (
        table === 'partnerSubjectSettings' &&
        ['create', 'linkIdentity', 'updateRelationship', 'addRole'].includes(
          action,
        )
      )
        permission = permission.create(supplierSettingColumns);
      if (table === 'partnerSubjectSettings' && action === 'updateRelationship')
        permission = permission.update(['notes', 'status']);
      if (
        table === 'partnerRolePolicies' &&
        ['create', 'addRole'].includes(action)
      )
        permission = permission.create(partnerPolicyColumns);
      if (
        table === 'partnerRolePolicies' &&
        action === 'configureApplicability'
      )
        permission = permission.update(['scopeMode', 'status']);
      if (table in partnerScopeColumns) {
        const columns =
          partnerScopeColumns[table as keyof typeof partnerScopeColumns];
        if (['create', 'addRole'].includes(action))
          permission = permission.create(columns);
        if (action === 'configureApplicability')
          permission = permission.create(columns).delete();
      }
      return permission.bind(table).build();
    });
    return {
      name: action,
      title: title(`actions.${action}`),
      grants: parts.flatMap((p) => p.grants),
      dataScopes: parts.flatMap((p) => p.dataScopes ?? []),
    };
  }),
};
const companyTables = ['partnerSubjectSettings', 'supplyChainAudit'];
export const supplierCompanyAccess = defineRecordAccess(
  'procurement.supplierCompanies',
  (a) =>
    a
      .title(title('selectedCompanies'))
      .collections(...companyTables)
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
export function supplierOwnCompanyAccess(
  database: DatabaseManager,
  timeZone: string,
) {
  return defineRecordAccess('procurement.ownSupplierCompany', (a) =>
    a
      .title(title('ownCompany'))
      .collections(...companyTables)
      .resolver(async ({ principal }) => {
        const subject = await currentCompanyForUser(
          database,
          timeZone,
          principal,
        );
        return subject ? condition('subjectId', '$eq', subject) : false;
      }),
  );
}

import { sourceReadColumns } from './material-source-resources.js';
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
import { businessMaterialColumns } from './supply-chain-resources.js';
import {
  supplierIdentityColumns,
  supplierSettingColumns,
  supplierAuditColumns,
} from './supplier-model.js';
import {
  partnerPolicyColumns,
  partnerScopeColumns,
} from './partner-applicability.js';
import {
  purchaseHeadColumns,
  purchaseLineColumns,
  purchaseVersionColumns,
  purchaseTaskColumns,
} from './purchase-request-model.js';

export const purchaseActions = [
  'read',
  'create',
  'update',
  'submit',
  'review',
  'withdraw',
  'revise',
  'cancel',
  'reassign',
  'delegate',
  'requestGovernance',
  'confirmMaterial',
  'rejectMaterial',
  'takeOverSource',
] as const;
export type PurchasePermissionAction = (typeof purchaseActions)[number];
const title = (key: string) => ({
  key: `procurement.purchase.${key}`,
  ns: 'group-erp',
});
export const purchaseReferenceColumns: Record<string, string[]> = {
  ...businessMaterialColumns,
  orgSubjects: ['id', 'code', 'name', 'status', 'type', 'regionId'],
  orgRegions: ['id', 'code', 'name', 'status', 'parentId'],
  orgUnits: ['id', 'code', 'name', 'status', 'subjectId'],
  orgPositions: ['id', 'code', 'name', 'status', 'unitId'],
  personnelEmployees: [
    'id',
    'code',
    'name',
    'status',
    'accountId',
    'subjectId',
  ],
  personnelEmployments: ['id', 'personId', 'subjectId', 'status', 'data'],
  personnelAssignments: [
    'id',
    'personId',
    'subjectId',
    'positionId',
    'status',
    'data',
  ],
  businessPartners: supplierIdentityColumns,
  partnerSubjectSettings: supplierSettingColumns,
  partnerRolePolicies: partnerPolicyColumns,
  ...partnerScopeColumns,
};
export const purchaseReadColumns: Record<string, string[]> = {
  ...sourceReadColumns,
  ...purchaseReferenceColumns,
  purchaseRequests: purchaseHeadColumns,
  purchaseRequestLines: purchaseLineColumns,
  supplyChainRequestVersions: purchaseVersionColumns,
  supplyChainReviewTasks: purchaseTaskColumns,
  supplyChainAudit: supplierAuditColumns,
};
export const purchaseResource: CompositeResource = {
  name: 'procurement.requests',
  title: title('title'),
  actions: purchaseActions.map((action) => {
    const parts = Object.entries(purchaseReadColumns).map(
      ([table, columns]) => {
        let permission = defineDatabasePermission((p) =>
          p.collection(table).read(columns),
        );
        if (table === 'purchaseRequests') {
          if (action === 'create')
            permission = permission.create(purchaseHeadColumns);
          else if (!['read', 'delegate'].includes(action))
            permission = permission.update(purchaseHeadColumns);
        }
        if (
          table === 'purchaseRequestLines' &&
          [
            'create',
            'update',
            'submit',
            'requestGovernance',
            'confirmMaterial',
            'rejectMaterial',
            'takeOverSource',
          ].includes(action)
        )
          permission = permission
            .create(purchaseLineColumns)
            .update(purchaseLineColumns);
        if (
          table === 'materialRequestSources' &&
          [
            'requestGovernance',
            'confirmMaterial',
            'rejectMaterial',
            'takeOverSource',
          ].includes(action)
        )
          permission = permission.create(columns).update(columns);
        if (table === 'materialRequests' && action === 'requestGovernance')
          permission = permission.create(columns).update(columns);
        return permission.bind(table).build();
      },
    );
    return {
      name: action,
      title: title(action),
      grants: parts.flatMap((p) => p.grants),
      dataScopes: parts.flatMap((p) => p.dataScopes ?? []),
    };
  }),
};
export const purchaseSettingsResource: CompositeResource = {
  name: 'procurement.settings',
  title: title('settings'),
  actions: ['read', 'update'].map((action) => {
    const parts = Object.entries(purchaseReferenceColumns).map(
      ([table, columns]) =>
        defineDatabasePermission((p) => p.collection(table).read(columns))
          .bind(table)
          .build(),
    );
    return {
      name: action,
      title: title(action === 'read' ? 'settingsRead' : 'settingsUpdate'),
      grants: parts.flatMap((p) => p.grants),
      dataScopes: parts.flatMap((p) => p.dataScopes ?? []),
    };
  }),
};
export const purchaseCompanyTables = [
  'materialRequestSources',
  'materialRequests',
  'purchaseRequests',
  'purchaseRequestLines',
  'supplyChainRequestVersions',
  'supplyChainReviewTasks',
  'supplyChainAudit',
  'personnelEmployees',
  'personnelEmployments',
  'personnelAssignments',
  'orgUnits',
  'partnerSubjectSettings',
  'materialSubjectSettings',
];
export const purchaseCompanyAccess = defineRecordAccess(
  'procurement.requestCompanies',
  (a) =>
    a
      .title(title('selectedCompanies'))
      .collections(...purchaseCompanyTables)
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
export function purchaseOwnCompanyAccess(
  db: DatabaseManager,
  timeZone: string,
) {
  return defineRecordAccess('procurement.ownRequestCompany', (a) =>
    a
      .title(title('ownCompany'))
      .collections(...purchaseCompanyTables)
      .resolver(async ({ principal }) => {
        const company = await currentCompanyForUser(db, timeZone, principal);
        return company ? condition('subjectId', '$eq', company) : false;
      }),
  );
}
export const purchaseOwnAccess = defineRecordAccess(
  'procurement.ownRequests',
  (a) =>
    a
      .title(title('ownRequests'))
      .collections('purchaseRequests')
      .resolver(({ principal }) =>
        principal.type === 'user'
          ? {
              kind: 'group',
              logic: 'or',
              items: [
                condition('createdBy', '$eq', principal.id),
                condition('requesterAccountId', '$eq', principal.id),
              ],
            }
          : false,
      ),
);

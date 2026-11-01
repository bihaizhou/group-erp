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
import { supplierAuditColumns } from './supplier-model.js';
import { issuePurposeColumns } from './issue-purpose-model.js';
import {
  issueHeadColumns,
  issueLineColumns,
  issueVersionColumns,
  issueTaskColumns,
} from './issue-request-model.js';

export const issueActions = [
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
export type IssuePermissionAction = (typeof issueActions)[number];
const title = (key: string) => ({
  key: `requisitions.issue.${key}`,
  ns: 'group-erp',
});
export const issueReferenceColumns: Record<string, string[]> = {
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
  materialIssuePurposes: issuePurposeColumns,
};
export const issueReadColumns: Record<string, string[]> = {
  ...sourceReadColumns,
  ...issueReferenceColumns,
  materialIssueRequests: issueHeadColumns,
  materialIssueRequestLines: issueLineColumns,
  supplyChainRequestVersions: issueVersionColumns,
  supplyChainReviewTasks: issueTaskColumns,
  supplyChainAudit: supplierAuditColumns,
};
export const issueResource: CompositeResource = {
  name: 'requisitions.requests',
  title: title('title'),
  actions: issueActions.map((action) => {
    const parts = Object.entries(issueReadColumns).map(([table, columns]) => {
      let permission = defineDatabasePermission((p) =>
        p.collection(table).read(columns),
      );
      if (table === 'materialIssueRequests') {
        if (action === 'create')
          permission = permission.create(issueHeadColumns);
        else if (!['read', 'delegate'].includes(action))
          permission = permission.update(issueHeadColumns);
      }
      if (
        table === 'materialIssueRequestLines' &&
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
          .create(issueLineColumns)
          .update(issueLineColumns);
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
    });
    return {
      name: action,
      title: title(action),
      grants: parts.flatMap((p) => p.grants),
      dataScopes: parts.flatMap((p) => p.dataScopes ?? []),
    };
  }),
};
export const issueSettingsResource: CompositeResource = {
  name: 'requisitions.settings',
  title: title('settings'),
  actions: ['read', 'update'].map((action) => {
    const parts = Object.entries(issueReferenceColumns).map(
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
export const issueCompanyTables = [
  'materialRequestSources',
  'materialRequests',
  'materialIssueRequests',
  'materialIssueRequestLines',
  'supplyChainRequestVersions',
  'supplyChainReviewTasks',
  'supplyChainAudit',
  'personnelEmployees',
  'personnelEmployments',
  'personnelAssignments',
  'orgUnits',
  'materialIssuePurposes',
  'materialSubjectSettings',
];
export const issueCompanyAccess = defineRecordAccess(
  'requisitions.requestCompanies',
  (a) =>
    a
      .title(title('selectedCompanies'))
      .collections(...issueCompanyTables)
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
export function issueOwnCompanyAccess(db: DatabaseManager, timeZone: string) {
  return defineRecordAccess('requisitions.ownRequestCompany', (a) =>
    a
      .title(title('ownCompany'))
      .collections(...issueCompanyTables)
      .resolver(async ({ principal }) => {
        const company = await currentCompanyForUser(db, timeZone, principal);
        return company ? condition('subjectId', '$eq', company) : false;
      }),
  );
}
export const issueOwnAccess = defineRecordAccess(
  'requisitions.ownRequests',
  (a) =>
    a
      .title(title('ownRequests'))
      .collections('materialIssueRequests')
      .resolver(({ principal }) =>
        principal.type === 'user'
          ? {
              kind: 'group',
              logic: 'or',
              items: [
                condition('createdBy', '$eq', principal.id),
                condition('requesterAccountId', '$eq', principal.id),
                condition('recipientAccountId', '$eq', principal.id),
              ],
            }
          : false,
      ),
);

export const issuePurposeResource: CompositeResource = {
  name: 'requisitions.purposes',
  title: { key: 'requisitions.purposes.title', ns: 'group-erp' },
  actions: ['read', 'create', 'update', 'activate', 'deactivate'].map(
    (action) => {
      const purposes = defineDatabasePermission((p) => {
        let permission = p
          .collection('materialIssuePurposes')
          .read(issuePurposeColumns);
        if (action === 'create')
          permission = permission.create(issuePurposeColumns);
        if (!['read', 'create'].includes(action))
          permission = permission.update(issuePurposeColumns);
        return permission;
      })
        .bind('materialIssuePurposes')
        .build();
      const company = defineDatabasePermission((p) =>
        p.collection('orgSubjects').read(['id', 'code', 'name', 'status']),
      )
        .bind('orgSubjects')
        .build();
      return {
        name: action,
        title: { key: `requisitions.purposes.${action}`, ns: 'group-erp' },
        grants: [...purposes.grants, ...company.grants],
        dataScopes: [
          ...(purposes.dataScopes ?? []),
          ...(company.dataScopes ?? []),
        ],
      };
    },
  ),
};

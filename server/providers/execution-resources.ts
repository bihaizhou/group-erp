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
import { supplierResource } from './supplier-resources.js';
import type { ExecutionKind } from './execution-workflow.js';

const common = [
  'id',
  'code',
  'subjectId',
  'warehouseId',
  'status',
  'revision',
  'lifecycleVersion',
  'statusChangedAt',
  'contentVersion',
  'reviewRound',
  'submittedVersionId',
  'approvedVersionId',
  'submittedBy',
  'submittedAt',
  'approvedAt',
  'reason',
  'notes',
  'occurredOn',
  'nonce',
  'createdBy',
  'updatedBy',
  'createdAt',
  'updatedAt',
];
const materialLine = [
  'id',
  'subjectId',
  'skuId',
  'baseUnitId',
  'unitId',
  'unitRuleId',
  'quantity',
  'baseQuantity',
  'numeratorSnapshot',
  'denominatorSnapshot',
  'materialSnapshot',
  'notes',
  'lineNo',
  'status',
  'revision',
];
const orderLine = [
  ...materialLine,
  'conversionModeSnapshot',
  'variancePercentSnapshot',
  'orderId',
  'nonce',
  'selectionInput',
  'unitPrice',
  'amount',
  'managementModeSnapshot',
  'fulfilledQuantity',
  'returnedQuantity',
  'replacementQuantity',
  'closedQuantity',
];
export const executionColumns: Record<string, string[]> = {
  purchaseOrders: [
    ...common,
    'sourceChannel',
    'partnerId',
    'currency',
    'deliveryOn',
    'deliveryTerms',
    'partnerSnapshot',
    'totalAmount',
    'supersedesId',
    'demandMode',
    'temporaryReason',
  ],
  salesOrders: [
    ...common,
    'sourceChannel',
    'partnerId',
    'currency',
    'deliveryOn',
    'deliveryTerms',
    'partnerSnapshot',
    'totalAmount',
    'supersedesId',
  ],
  stockDocuments: [
    ...common,
    'kind',
    'originalDocumentId',
    'originalPostingId',
    'purchaseOrderId',
    'salesOrderId',
    'issueRequestId',
    'transferId',
    'countId',
    'initializationReference',
    'productionEvidence',
    'lossEvidence',
    'inspectionEvidence',
    'evidence',
    'postedBy',
    'postedAt',
    'supersedesId',
  ],
  stockTransfers: [...common, 'destinationWarehouseId', 'supersedesId'],
  stockCounts: [...common, 'baselineAt', 'countedActors', 'supersedesId'],
  purchaseOrderLines: orderLine,
  salesOrderLines: orderLine,
  stockDocumentLines: [
    ...materialLine,
    'conversionModeSnapshot',
    'variancePercentSnapshot',
    'documentId',
    'issueRequestId',
    'issueRequestLineId',
    'originalLineId',
    'originalDocumentId',
    'purchaseOrderId',
    'purchaseOrderLineId',
    'salesOrderId',
    'salesOrderLineId',
    'transferId',
    'transferLineId',
    'sourceBalanceId',
    'sourceSnapshot',
    'returnedQuantity',
    'rejectedQuantity',
    'baseRejectedQuantity',
    'replenishmentRequested',
    'quality',
    'targetQuality',
    'condition',
    'selectionInput',
  ],
  stockTransferLines: [
    ...materialLine,
    'transferId',
    'nonce',
    'quality',
    'selectionInput',
    'dispatchedQuantity',
    'receivedQuantity',
    'discrepancyQuantity',
  ],
  stockCountLines: [
    'id',
    'countId',
    'subjectId',
    'warehouseId',
    'skuId',
    'baseUnitId',
    'balanceId',
    'quality',
    'baselineQuantity',
    'actualQuantity',
    'materialSnapshot',
    'reason',
    'notes',
    'countedBy',
    'revision',
  ],
  executionVersions: [
    'id',
    'kind',
    'documentId',
    'subjectId',
    'purchaseOrderId',
    'salesOrderId',
    'stockDocumentId',
    'transferId',
    'countId',
    'contentVersion',
    'payload',
    'createdAt',
  ],
  executionReviewTasks: [
    'id',
    'kind',
    'documentId',
    'subjectId',
    'versionId',
    'round',
    'status',
    'candidates',
    'excludedActors',
    'parameterSnapshot',
    'submittedBy',
    'decidedBy',
    'reason',
    'createdAt',
    'decidedAt',
  ],
  purchaseAllocations: [
    'id',
    'subjectId',
    'orderId',
    'orderLineId',
    'requestId',
    'requestLineId',
    'requestVersionId',
    'baseQuantity',
    'status',
    'createdAt',
    'updatedAt',
  ],
  stockBalances: [
    'id',
    'subjectId',
    'warehouseId',
    'transferId',
    'dimensionKey',
    'skuId',
    'baseUnitId',
    'quality',
    'quantity',
    'reservedQuantity',
    'revision',
    'updatedAt',
  ],
  stockMovements: [
    'id',
    'postingId',
    'documentId',
    'documentLineId',
    'subjectId',
    'warehouseId',
    'transferId',
    'dimensionKey',
    'skuId',
    'baseUnitId',
    'balanceId',
    'ordinal',
    'quality',
    'deltaQuantity',
    'createdAt',
  ],
  stockPostings: [
    'id',
    'documentId',
    'subjectId',
    'reversesPostingId',
    'fingerprint',
    'actorId',
    'reason',
    'createdAt',
  ],
  stockReservations: [
    'id',
    'balanceId',
    'subjectId',
    'warehouseId',
    'skuId',
    'quality',
    'sourceKind',
    'issueRequestId',
    'issueRequestLineId',
    'salesOrderId',
    'salesOrderLineId',
    'quantity',
    'consumedQuantity',
    'releasedQuantity',
    'remainingQuantity',
    'revision',
    'createdBy',
    'createdAt',
    'updatedAt',
  ],
  stockReservationConsumptions: [
    'id',
    'postingId',
    'documentId',
    'documentLineId',
    'reservationId',
    'balanceId',
    'subjectId',
    'quantity',
    'kind',
    'originalConsumptionId',
    'restoredActive',
    'createdAt',
  ],
  stockIssueFulfillments: [
    'id',
    'issueRequestId',
    'subjectId',
    'skuId',
    'baseUnitId',
    'issuedQuantity',
    'returnedQuantity',
    'revision',
  ],
};
export const executionReferences: Record<string, string[]> = {
  ...businessMaterialColumns,
  materialSubjectSettings: [
    ...businessMaterialColumns.materialSubjectSettings,
    'canSell',
  ],
  orgSubjects: ['id', 'code', 'name', 'status', 'type', 'regionId'],
  warehouses: [
    'id',
    'code',
    'name',
    'subjectId',
    'status',
    'revision',
    'lifecycleVersion',
  ],
  businessPartners: supplierIdentityColumns,
  partnerSubjectSettings: supplierSettingColumns,
  partnerRolePolicies: partnerPolicyColumns,
  ...partnerScopeColumns,
  orgRegions: ['id', 'code', 'name', 'status', 'parentId'],
};
const reviewReferences = {
  orgPositions: ['id', 'code', 'name', 'unitId', 'status'],
  orgUnits: ['id', 'code', 'name', 'subjectId', 'status'],
  personnelEmployees: [
    'id',
    'code',
    'name',
    'subjectId',
    'status',
    'accountId',
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
};
export const executionSourceReferences: Record<string, string[]> = {
  purchaseRequests: [
    'id',
    'code',
    'subjectId',
    'status',
    'revision',
    'lifecycleVersion',
    'contentVersion',
    'approvedVersionId',
  ],
  purchaseRequestLines: [
    'id',
    'requestId',
    'subjectId',
    'status',
    'identificationStatus',
    'skuId',
    'baseUnitId',
    'unitId',
    'unitRuleId',
    'requestedQuantity',
    'baseQuantity',
    'materialSnapshot',
    'numeratorSnapshot',
    'denominatorSnapshot',
  ],
  materialIssueRequests: [
    'id',
    'code',
    'subjectId',
    'status',
    'revision',
    'lifecycleVersion',
    'contentVersion',
    'approvedVersionId',
    'requesterEmployeeId',
    'recipientEmployeeId',
  ],
  materialIssueRequestLines: [
    'id',
    'requestId',
    'subjectId',
    'status',
    'identificationStatus',
    'skuId',
    'baseUnitId',
    'unitId',
    'unitRuleId',
    'requestedQuantity',
    'baseQuantity',
    'materialSnapshot',
    'numeratorSnapshot',
    'denominatorSnapshot',
  ],
};
export const executionResourceIds: Record<ExecutionKind, string> = {
  purchaseOrders: 'procurement.orders',
  salesOrders: 'sales.orders',
  stockDocuments: 'warehouse.documents',
  stockTransfers: 'warehouse.transfers',
  stockCounts: 'warehouse.counts',
};
export const executionActions = [
  'read',
  'create',
  'update',
  'submit',
  'review',
  'withdraw',
  'revise',
  'cancel',
  'reassign',
  'copy',
  'post',
  'initial',
  'loss',
  'productionReceipt',
  'productionIssue',
  'quality',
  'reverse',
  'dispatch',
  'receive',
  'discrepancy',
  'start',
  'closeRemainder',
] as const;
export type ExecutionAction = (typeof executionActions)[number];
export const executionCompanyCollections = [
  'orgSubjects',
  'warehouses',
  ...Object.keys(executionColumns),
  'purchaseRequests',
  'purchaseRequestLines',
  'materialIssueRequests',
  'materialIssueRequestLines',
  'supplyChainAudit',
  'materialSubjectSettings',
  'partnerSubjectSettings',
  'personnelEmployees',
  'personnelEmployments',
  'personnelAssignments',
  'orgUnits',
];
const title = (key: string) => ({ key: `execution.${key}`, ns: 'group-erp' });
const permissions = (
  columns: Record<string, string[]>,
  action: string,
  head?: string,
  line?: string,
) =>
  Object.entries(columns).map(([table, fields]) => {
    let p = defineDatabasePermission((d) => d.collection(table).read(fields));
    if (table === head && action === 'create') p = p.create(fields);
    if (table === head && !['read', 'create', 'copy'].includes(action))
      p = p.update(fields);
    if (table === head && action === 'copy') p = p.create(fields);
    if (
      table === line &&
      ['create', 'copy', 'update', 'closeRemainder'].includes(action)
    )
      p = p
        .create(
          table === 'stockDocumentLines'
            ? [...fields, 'commercialSnapshot', 'nonce']
            : fields,
        )
        .update(
          table === 'stockDocumentLines'
            ? [...fields, 'commercialSnapshot', 'nonce']
            : fields,
        );
    // Warehouse users may record the server-copied commercial basis without
    // reading it. It is absent from the ordinary read projection above.
    if (
      table === 'purchaseAllocations' &&
      ['create', 'copy', 'update'].includes(action)
    )
      p = p.create(fields).update(fields);
    return p.bind(table).build();
  });
export const executionResources: CompositeResource[] = (
  Object.keys(executionResourceIds) as ExecutionKind[]
).map((kind) => ({
  name: executionResourceIds[kind],
  title: title(kind),
  actions: executionActions
    .filter((action) => {
      if (kind.endsWith('Orders'))
        return [
          'read',
          'create',
          'update',
          'submit',
          'review',
          'withdraw',
          'revise',
          'cancel',
          'reassign',
          'copy',
          'closeRemainder',
        ].includes(action);
      if (kind === 'stockTransfers')
        return [
          'read',
          'create',
          'update',
          'submit',
          'review',
          'withdraw',
          'revise',
          'cancel',
          'reassign',
          'copy',
          'dispatch',
          'receive',
          'discrepancy',
        ].includes(action);
      if (kind === 'stockCounts')
        return [
          'read',
          'create',
          'update',
          'start',
          'submit',
          'review',
          'withdraw',
          'cancel',
          'reassign',
          'copy',
        ].includes(action);
      return ![
        'start',
        'closeRemainder',
        'dispatch',
        'receive',
        'discrepancy',
      ].includes(action);
    })
    .map((action) => {
      const line = {
          purchaseOrders: 'purchaseOrderLines',
          salesOrders: 'salesOrderLines',
          stockDocuments: 'stockDocumentLines',
          stockTransfers: 'stockTransferLines',
          stockCounts: 'stockCountLines',
        }[kind],
        extra =
          kind === 'stockDocuments' ||
          kind === 'stockTransfers' ||
          kind === 'stockCounts'
            ? executionColumns
            : {
                [kind]: executionColumns[kind],
                [line]: executionColumns[line],
                purchaseAllocations: executionColumns.purchaseAllocations,
              },
        parts = permissions(
          {
            ...executionReferences,
            ...executionSourceReferences,
            ...extra,
            executionVersions: executionColumns.executionVersions,
            executionReviewTasks: executionColumns.executionReviewTasks,
            supplyChainAudit: supplierAuditColumns,
          },
          action,
          kind,
          line,
        );
      return {
        name: action,
        title: title(`actions.${action}`),
        grants: parts.flatMap((p) => p.grants),
        dataScopes: parts.flatMap((p) => p.dataScopes ?? []),
      };
    }),
}));
export const inventoryResource: CompositeResource = {
  name: 'warehouse.inventory',
  title: title('inventory'),
  actions: ['read', 'reserve', 'release', 'reconcile'].map((action) => {
    const parts = permissions(
      {
        ...executionReferences,
        ...executionSourceReferences,
        ...executionColumns,
        supplyChainAudit: supplierAuditColumns,
      },
      'read',
    );
    return {
      name: action,
      title: title(`actions.${action}`),
      grants: parts.flatMap((p) => p.grants),
      dataScopes: parts.flatMap((p) => p.dataScopes ?? []),
    };
  }),
};
export const executionSettingsResource: CompositeResource = {
  name: 'warehouse.settings',
  title: title('settings'),
  actions: ['read', 'update'].map((action) => {
    const parts = permissions(
      { ...executionReferences, ...reviewReferences },
      'read',
    );
    return {
      name: action,
      title: title(`actions.${action}`),
      grants: parts.flatMap((p) => p.grants),
      dataScopes: parts.flatMap((p) => p.dataScopes ?? []),
    };
  }),
};
export const customerResource: CompositeResource = {
  ...supplierResource,
  name: 'sales.customers',
  title: title('customers'),
  actions: supplierResource.actions.map((action) => ({
    ...action,
    title: title(`customerActions.${action.name}`),
  })),
};
export const executionCompanyAccess = defineRecordAccess(
  'execution.companies',
  (a) =>
    a
      .title(title('selectedCompanies'))
      .collections(...executionCompanyCollections)
      .params<{ subjectIds: string[] }>({
        type: 'object',
        properties: {
          subjectIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['subjectIds'],
      })
      .resolver(({ params, collection }) =>
        Array.isArray(params?.subjectIds) &&
        params.subjectIds.length > 0 &&
        params.subjectIds.length <= 500
          ? {
              kind: 'group',
              logic: 'or',
              items: params.subjectIds.map((id) =>
                condition(
                  collection === 'orgSubjects' ? 'id' : 'subjectId',
                  '$eq',
                  id,
                ),
              ),
            }
          : false,
      ),
);
export const executionWarehouseAccess = defineRecordAccess(
  'execution.warehouses',
  (a) =>
    a
      .title(title('selectedWarehouses'))
      .collections(
        'warehouses',
        'purchaseOrders',
        'salesOrders',
        'stockDocuments',
        'stockCounts',
        'stockTransfers',
      )
      .params<{ warehouseIds: string[] }>({
        type: 'object',
        properties: {
          warehouseIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['warehouseIds'],
      })
      .resolver(({ params, collection }) =>
        Array.isArray(params?.warehouseIds) &&
        params.warehouseIds.length > 0 &&
        params.warehouseIds.length <= 500
          ? {
              kind: 'group',
              logic: 'or',
              items: params.warehouseIds.flatMap((id) => [
                condition(
                  collection === 'warehouses' ? 'id' : 'warehouseId',
                  '$eq',
                  id,
                ),
                ...(collection === 'stockTransfers'
                  ? [condition('destinationWarehouseId', '$eq', id)]
                  : []),
              ]),
            }
          : false,
      ),
);
export function executionOwnCompanyAccess(
  db: DatabaseManager,
  timeZone: string,
) {
  return defineRecordAccess('execution.ownCompany', (a) =>
    a
      .title(title('ownCompany'))
      .collections(...executionCompanyCollections)
      .resolver(async ({ principal, collection }) => {
        const company = await currentCompanyForUser(db, timeZone, principal);
        return company
          ? condition(
              collection === 'orgSubjects' ? 'id' : 'subjectId',
              '$eq',
              company,
            )
          : false;
      }),
  );
}

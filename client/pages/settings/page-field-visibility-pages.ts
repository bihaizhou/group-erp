import {
  fields as organizationFields,
  kinds as organizationKinds,
} from '../organization/model.js';
import {
  fields as materialFields,
  kinds as materialKinds,
  pageId as materialPageId,
} from '../materials/model.js';
import {
  fields as peopleFields,
  kinds as peopleKinds,
} from '../people/model.js';
import { executionPages } from '../execution/model.js';
import { pageFieldVisibilityInheritedFrom } from './page-field-visibility-fallback.js';

const executionNestedKinds = [
  'receipts',
  'shipments',
  'dispatch',
  'receive',
  'discrepancy',
  'reversal',
  'returns',
] as const;
const executionDocumentKinds = ['reversal', 'returns'] as const;

/**
 * Pages whose forms already read the page-level field visibility setting.
 * Only these pages may offer the per-page field editor; adding a page here
 * without wiring `usePageFieldVisibility` into its form would let an
 * administrator save a configuration that has no visible effect.
 */
export const pageFieldVisibilityPageKeys: ReadonlySet<string> = new Set([
  'procurement-requests',
  'procurement-requests-detail',
  'procurement-requests-new',
  'sales-price-lists',
  'sales-receivables',
  'production-overview',
  'production-report',
  'production-schedules',
  'production-shift-reports',
  'production-equipment',
  'production-maintenance-plans',
  'production-downtime',
  'production-overtime',
  'production-setup',
  'hse-overview',
  'hse-incidents',
  'hse-hazards',
  'hse-certificates',
  'hse-inspections',
  'hse-work-permits',
  'hse-training-records',
  'hse-actions',
  'operations-overview',
  'operations-issues',
  'operations-targets',
  'assets-list',
  ...peopleKinds.flatMap((kind) => [
    `people-${kind}`,
    ...(kind === 'profiles' ? [] : [`people-${kind}-detail`]),
    ...(peopleFields[kind].length > 0 ? [`people-${kind}-new`] : []),
  ]),
  ...organizationKinds.map((kind) => `organization-${kind}-new`),
  ...materialKinds
    .filter((kind) => materialFields[kind].length > 0)
    .map((kind) => `${materialPageId(kind)}-new`),
  'warehouse-material-templates-new',
  'warehouse-materials-request-material',
  'warehouse-material-requests-new-sku',
  'sales-orders-new',
  'procurement-orders-new',
  'procurement-suppliers-new',
  'sales-customers-new',
  'requisitions-requests-new',
  'requisitions-purposes-new',
  'warehouse-inbounds-new',
  'warehouse-outbounds-new',
  'warehouse-transfers-new',
  'warehouse-counts-new',
  ...executionPages.flatMap(({ page }) => [page, `${page}-detail`]),
  ...executionPages.flatMap(({ page }) => [
    ...executionNestedKinds.map((kind) => `${page}-${kind}-new`),
    ...executionDocumentKinds.map(
      (kind) => `${page}-execution-document-${kind}`,
    ),
  ]),
]);

const executionDocumentFields: Record<string, readonly string[]> = {
  'sales-orders-new': [
    'currency',
    'sourceRef',
    'sourceDoc',
    'period',
    'deliveryTerms',
    'notes',
  ],
  'procurement-orders-new': [
    'currency',
    'sourceRef',
    'sourceDoc',
    'period',
    'deliveryTerms',
    'notes',
  ],
  'warehouse-inbounds-new': [
    'reason',
    'sourceRef',
    'sourceDoc',
    'period',
    'notes',
  ],
  'warehouse-outbounds-new': [
    'reason',
    'sourceRef',
    'sourceDoc',
    'period',
    'notes',
  ],
  'warehouse-transfers-new': [
    'reason',
    'sourceRef',
    'sourceDoc',
    'period',
    'notes',
  ],
  'warehouse-counts-new': [
    'reason',
    'sourceRef',
    'sourceDoc',
    'period',
    'notes',
  ],
};

/**
 * Fields the page's form actually consults. Keeping this list beside the page
 * key stops the editor from offering a checkbox that would have no effect.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const pageFieldVisibilityFields: Readonly<
  Record<string, readonly string[]>
> = {
  'sales-price-lists': [
    'sales.priceList.customerId',
    'sales.priceList.skuId',
    'sales.priceList.unitPrice',
    'sales.priceList.currency',
    'sales.priceList.effectiveFrom',
    'sales.priceList.effectiveTo',
    'sales.priceList.status',
    'sales.priceList.note',
  ],
  'sales-receivables': [
    'sales.receivable.documentId',
    'sales.receivable.customerId',
    'sales.receivable.amount',
    'sales.receivable.currency',
    'sales.receivable.paid',
    'sales.receivable.outstanding',
    'sales.receivable.status',
  ],
  'procurement-requests': [
    'purchase.request.code',
    'purchase.request.company',
    'purchase.request.requester',
    'purchase.request.unit',
    'purchase.request.usage',
    'purchase.request.neededOn',
    'purchase.request.status',
    'purchase.request.identification',
    'purchase.request.updatedAt',
  ],
  'procurement-requests-detail': [
    'purchase.request.company',
    'purchase.request.requester',
    'purchase.request.unit',
    'purchase.request.businessDate',
    'purchase.request.sourceChannel',
    'purchase.request.sourceRef',
    'purchase.request.sourceDoc',
    'purchase.request.period',
    'purchase.request.neededOn',
    'purchase.request.usage',
    'purchase.request.notes',
  ],
  'procurement-suppliers-new': [
    'procurement.supplier.base.code',
    'procurement.supplier.base.name',
    'procurement.supplier.base.registrationCode',
    'procurement.supplier.base.notes',
  ],
  'sales-customers-new': [
    'sales.customer.code',
    'sales.customer.name',
    'sales.customer.registrationCode',
    'sales.customer.notes',
  ],
  'requisitions-requests-new': ['issue.request.notes'],
  'requisitions-purposes-new': [
    'issue.purpose.code',
    'issue.purpose.name',
    'issue.purpose.description',
  ],
  'procurement-requests-new': [
    'purchase.request.requesterEmployeeId',
    'purchase.request.requestingUnitId',
    'purchase.request.usage',
    'purchase.request.neededOn',
    'purchase.request.businessDate',
    'purchase.request.sourceRef',
    'purchase.request.sourceDoc',
    'purchase.request.period',
    'purchase.request.notes',
  ],
  ...Object.fromEntries(
    peopleKinds
      .filter((kind) => peopleFields[kind].length > 0)
      .map((kind) => [
        `people-${kind}-new`,
        peopleFields[kind].map(
          (field) => `people.${peopleResource(kind)}.${field.key}`,
        ),
      ]),
  ),
  ...Object.fromEntries(
    peopleKinds.map((kind) => [
      `people-${kind}`,
      peopleListFields(kind).map(
        (field) => `people.${peopleResource(kind)}.${field}`,
      ),
    ]),
  ),
  ...Object.fromEntries(
    peopleKinds
      .filter((kind) => kind !== 'profiles')
      .map((kind) => [
        `people-${kind}-detail`,
        peopleFields[kind].map(
          (field) => `people.${peopleResource(kind)}.${field.key}`,
        ),
      ]),
  ),
  ...Object.fromEntries(
    executionPages.flatMap(({ page, kind }) => [
      [
        page,
        executionListFields(kind).map((field) => `execution.document.${field}`),
      ],
      [
        `${page}-detail`,
        [
          ...executionDetailFields(kind).map(
            (field) => `execution.document.${field}`,
          ),
          ...executionLineFields(kind).map(
            (field) => `execution.document.line.${field}`,
          ),
        ],
      ],
    ]),
  ),
  ...Object.fromEntries(
    organizationKinds.map((kind) => [
      `organization-${kind}-new`,
      organizationFields[kind].map(
        (field) => `organization.${organizationResource(kind)}.${field.key}`,
      ),
    ]),
  ),
  ...Object.fromEntries(
    materialKinds
      .filter((kind) => materialFields[kind].length > 0)
      .map((kind) => [
        `${materialPageId(kind)}-new`,
        materialFields[kind].map(
          (field) => `materials.${materialResource(kind)}.${field.key}`,
        ),
      ]),
  ),
  'warehouse-materials-request-material': materialFields.requests.map(
    (field) => `materials.request.${field.key}`,
  ),
  'warehouse-material-requests-new-sku': materialFields.skus.map(
    (field) => `materials.sku.${field.key}`,
  ),
  'warehouse-material-templates-new': [
    'materials.template.key',
    'materials.template.title',
    'materials.template.unit',
    'materials.template.type',
    'materials.template.required',
    'materials.template.identity',
  ],
  ...Object.fromEntries(
    Object.entries(executionDocumentFields).map(([pageKey, fields]) => [
      pageKey,
      fields.map((field) => `execution.document.${field}`),
    ]),
  ),
  ...Object.fromEntries(
    executionPages.flatMap(({ page }) => [
      ...executionNestedKinds.map((kind) => [
        `${page}-${kind}-new`,
        ['execution.document.reason', 'execution.document.notes'],
      ]),
      ...executionDocumentKinds.map((kind) => [
        `${page}-execution-document-${kind}`,
        ['execution.document.reason', 'execution.document.notes'],
      ]),
    ]),
  ),
  'production-overview': [
    'production.overview.processed',
    'production.overview.reports',
    'production.overview.confirmed',
    'production.overview.runtime',
  ],
  'production-report': [
    'production.report.material.quantity',
    'production.report.material.stockQuantity',
    'production.report.material.bookQuantity',
    'production.report.shift.runtimeMinutes',
    'production.report.shift.downtimeMinutes',
    'production.report.shift.notes',
    'production.report.attendance.status',
    'production.report.attendance.absenceReason',
    'production.report.attendance.overtimeMinutes',
    'production.report.attendance.overtimeContent',
    'production.report.downtime.startedAt',
    'production.report.downtime.category',
    'production.report.downtime.impact',
    'production.report.downtime.description',
    'production.report.maintenance.type',
    'production.report.maintenance.assigneeName',
    'production.report.maintenance.description',
    'production.report.overtime.type',
    'production.report.overtime.hours',
    'production.report.overtime.reason',
  ],
  'production-schedules': [
    'production.schedule.scheduleDate',
    'production.schedule.shift',
    'production.schedule.status',
    'production.schedule.notes',
  ],
  'production-shift-reports': [
    'production.shiftReport.reportDate',
    'production.shiftReport.shift',
    'production.shiftReport.status',
  ],
  'production-equipment': [
    'production.equipment.code',
    'production.equipment.name',
    'production.equipment.category',
    'production.equipment.criticality',
    'production.equipment.status',
  ],
  'production-maintenance-plans': [
    'production.plan.name',
    'production.plan.type',
    'production.plan.intervalDays',
    'production.plan.nextDueOn',
    'production.plan.checklist',
    'production.plan.assigneeName',
    'production.plan.status',
  ],
  'production-downtime': [
    'production.downtime.startedAt',
    'production.downtime.endedAt',
    'production.downtime.durationMinutes',
    'production.downtime.category',
    'production.downtime.impact',
    'production.downtime.status',
    'production.downtime.description',
    'production.downtime.resolution',
  ],
  'production-overtime': [
    'production.overtime.requestNo',
    'production.overtime.businessDate',
    'production.overtime.hours',
    'production.overtime.type',
    'production.overtime.reason',
    'production.overtime.compensation',
    'production.overtime.status',
  ],
  'production-setup': [
    'production.setupUnit.lineCode',
    'production.setupUnit.processType',
    'production.setupUnit.designCapacityTpd',
    'production.setupUnit.commissionDate',
    'production.setupUnit.region',
    'production.setupUnit.status',
    'production.setupMaterial.role',
    'production.setupMaterial.defaultWarehouseId',
    'production.setupMaterial.notes',
  ],
  'hse-overview': [
    'hse.overview.incidentsOpen',
    'hse.overview.incidentsLti',
    'hse.overview.hazardsOpen',
    'hse.overview.hazardsOverdue',
    'hse.overview.certificatesExpiring90',
  ],
  'hse-incidents': [
    'hse.incident.incidentNo',
    'hse.incident.occurredAt',
    'hse.incident.type',
    'hse.incident.severity',
    'hse.incident.location',
    'hse.incident.injuryCount',
    'hse.incident.lostDays',
    'hse.incident.environmentalRelease',
    'hse.incident.status',
    'hse.incident.actions',
  ],
  'hse-hazards': [
    'hse.hazard.level',
    'hse.hazard.description',
    'hse.hazard.location',
    'hse.hazard.ownerName',
    'hse.hazard.dueAt',
    'hse.hazard.status',
    'hse.hazard.rectification',
  ],
  'hse-certificates': [
    'hse.certificate.holderType',
    'hse.certificate.holderName',
    'hse.certificate.certType',
    'hse.certificate.certNo',
    'hse.certificate.issuedAt',
    'hse.certificate.expiresAt',
    'hse.certificate.authority',
    'hse.certificate.status',
  ],
  'hse-inspections': [
    'hse.inspection.type',
    'hse.inspection.unitId',
    'hse.inspection.plannedAt',
    'hse.inspection.inspectorId',
    'hse.inspection.findingsCount',
    'hse.inspection.completedAt',
    'hse.inspection.status',
  ],
  'hse-work-permits': [
    'hse.workPermit.permitNo',
    'hse.workPermit.type',
    'hse.workPermit.unitId',
    'hse.workPermit.workDescription',
    'hse.workPermit.location',
    'hse.workPermit.validFrom',
    'hse.workPermit.validTo',
    'hse.workPermit.riskMeasures',
    'hse.workPermit.approverId',
    'hse.workPermit.status',
  ],
  'hse-training-records': [
    'hse.trainingRecord.personId',
    'hse.trainingRecord.courseType',
    'hse.trainingRecord.courseName',
    'hse.trainingRecord.completedAt',
    'hse.trainingRecord.score',
    'hse.trainingRecord.certificateId',
    'hse.trainingRecord.status',
  ],
  'hse-actions': [
    'hse.action.sourceType',
    'hse.action.sourceId',
    'hse.action.unitId',
    'hse.action.description',
    'hse.action.ownerName',
    'hse.action.ownerId',
    'hse.action.dueAt',
    'hse.action.status',
    'hse.action.completedAt',
    'hse.action.verifiedBy',
    'hse.action.verifiedAt',
  ],
  'operations-overview': [
    'operations.overview.processed',
    'operations.overview.metal',
    'operations.overview.sand',
    'operations.overview.metalRate',
    'operations.overview.stockMetal',
    'operations.overview.stockSand',
    'operations.overview.salesOpen',
    'operations.overview.procurementOpen',
    'operations.overview.peopleActive',
    'operations.overview.issueOpen',
  ],
  'operations-issues': [
    'operations.issue.code',
    'operations.issue.title',
    'operations.issue.description',
    'operations.issue.severity',
    'operations.issue.ownerName',
    'operations.issue.dueAt',
    'operations.issue.status',
    'operations.issue.resolution',
    'operations.issue.businessDate',
    'operations.issue.sourceType',
  ],
  'operations-targets': [
    'operations.target.metric',
    'operations.target.targetValue',
    'operations.target.actualValue',
    'operations.target.achievementPct',
    'operations.target.progressPct',
    'operations.target.varianceValue',
    'operations.target.status',
    'operations.target.updatedAt',
  ],
  'assets-list': [
    'people.assets.code',
    'people.assets.name',
    'people.assets.category',
    'people.assets.status',
    'people.assets.custodianEmployeeId',
    'people.assets.location',
    'people.assets.acquiredOn',
    'people.assets.originalCost',
    'people.assets.currency',
    'people.assets.notes',
  ],
};

function organizationResource(
  kind: (typeof organizationKinds)[number],
): string {
  return {
    subjects: 'subject',
    units: 'unit',
    positions: 'position',
    sectors: 'sector',
    regions: 'region',
    relations: 'relation',
  }[kind];
}

function executionListFields(kind: string): string[] {
  return [
    'code',
    ...(kind === 'purchaseOrders' || kind === 'salesOrders' ? ['partner'] : []),
    ...(kind === 'inbounds' || kind === 'outbounds' ? ['kind'] : []),
    'warehouse',
    ...(kind === 'stockTransfers' ? ['destinationWarehouse'] : []),
    'status',
    'progress',
    ...(kind === 'purchaseOrders' || kind === 'salesOrders'
      ? ['deliveryOn']
      : kind === 'stockCounts'
        ? ['baselineAt']
        : ['occurredOn']),
    'updatedAt',
  ];
}

function executionDetailFields(kind: string): string[] {
  return [
    'company',
    'warehouse',
    ...(kind === 'stockTransfers' ? ['destinationWarehouse'] : []),
    ...(kind === 'purchaseOrders'
      ? ['supplier']
      : kind === 'salesOrders'
        ? ['customer']
        : []),
    ...(kind === 'purchaseOrders' || kind === 'salesOrders'
      ? ['currency', 'deliveryOn', 'deliveryTerms', 'sourceChannel']
      : []),
    'occurredOn',
    ...(kind === 'stockCounts' ? ['baselineAt'] : []),
    'issueRequest',
    'recipient',
    'reason',
    'notes',
  ];
}

function executionLineFields(kind: string): string[] {
  return [
    ...(kind === 'stockCounts'
      ? ['baselineQuantity', 'countedQuantity', 'reason']
      : ['quantity', 'baseQuantity']),
    ...(kind === 'purchaseOrders' || kind === 'salesOrders'
      ? [
          'unitPrice',
          'amount',
          'fulfilledQuantity',
          'returnedQuantity',
          'netExecuted',
          'remainingQuantity',
          'closedQuantity',
        ]
      : []),
    ...(kind === 'stockTransfers'
      ? [
          'dispatchedQuantity',
          'receivedQuantity',
          'discrepancyQuantity',
          'transit',
          'remainingQuantity',
        ]
      : []),
    'quality',
  ];
}

function executionFieldTitle(field: string, kind: string): string {
  if (field === 'partner')
    return kind === 'purchaseOrders'
      ? 'execution.supplier'
      : 'execution.customer';
  if (field === 'progress') return 'execution.lineProgress';
  if (field === 'kind') return 'execution.sourceType';
  return `execution.${field}`;
}

function peopleListFields(kind: (typeof peopleKinds)[number]): string[] {
  return [
    'name',
    'code',
    'subjectId',
    ...(kind === 'profiles' ? ['grade'] : ['personId']),
    'status',
    'updatedAt',
  ];
}

function peopleResource(kind: (typeof peopleKinds)[number]): string {
  return {
    employees: 'employee',
    employments: 'employment',
    assignments: 'assignment',
    changes: 'change',
    dimensions: 'dimension',
    models: 'model',
    profiles: 'profile',
    evaluations: 'evaluation',
    developmentPlans: 'developmentPlan',
    workforcePlans: 'workforcePlan',
  }[kind];
}

function materialResource(kind: (typeof materialKinds)[number]): string {
  return {
    names: 'name',
    skus: 'sku',
    templates: 'template',
    units: 'unit',
    unitRules: 'unitRule',
    references: 'reference',
    tags: 'tag',
    tagLinks: 'tagLink',
    requests: 'request',
    warehouses: 'warehouse',
  }[kind];
}

/** Fields rendered by a form but not present as columns in the catalog. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const pageFieldVisibilityExtraFields: Readonly<
  Record<
    string,
    readonly {
      readonly resource: string;
      readonly field: string;
      readonly titleKey: string;
    }[]
  >
> = {
  ...Object.fromEntries(
    materialKinds
      .filter((kind) => materialFields[kind].length > 0)
      .map((kind) => [
        `${materialPageId(kind)}-new`,
        materialFields[kind].map((field) => ({
          resource: `materials.${materialResource(kind)}`,
          field: field.key,
          titleKey: `materials.fields.${field.key}`,
        })),
      ]),
  ),
  'warehouse-materials-request-material': materialFields.requests.map(
    (field) => ({
      resource: 'materials.request',
      field: field.key,
      titleKey: `materials.fields.${field.key}`,
    }),
  ),
  'warehouse-material-requests-new-sku': materialFields.skus.map((field) => ({
    resource: 'materials.sku',
    field: field.key,
    titleKey: `materials.fields.${field.key}`,
  })),
  'warehouse-material-templates-new': [
    'unit',
    'type',
    'required',
    'identity',
  ].map((field) => ({
    resource: 'materials.template',
    field,
    titleKey: `materials.attribute.${field}`,
  })),
  ...Object.fromEntries(
    Object.entries(executionDocumentFields).map(([pageKey, fields]) => [
      pageKey,
      fields
        .filter((field) => !['reason', 'notes'].includes(field))
        .map((field) => ({
          resource: 'execution.document',
          field,
          titleKey: `execution.${field}`,
        })),
    ]),
  ),
  'sales-price-lists': [
    ['customerId', 'customer'],
    ['skuId', 'material'],
    ['unitPrice', 'unitPrice'],
    ['currency', 'currency'],
    ['effectiveFrom', 'effectiveFrom'],
    ['effectiveTo', 'effectiveTo'],
    ['status', 'status'],
    ['note', 'note'],
  ].map(([field, key]) => ({
    resource: 'sales.priceList',
    field,
    titleKey: `execution.priceLists.${key}`,
  })),
  'sales-receivables': [
    ['documentId', 'document'],
    ['customerId', 'customer'],
    ['amount', 'amount'],
    ['currency', 'currency'],
    ['paid', 'paid'],
    ['outstanding', 'outstanding'],
    ['status', 'status'],
  ].map(([field, key]) => ({
    resource: 'sales.receivable',
    field,
    titleKey: `execution.receivables.${key}`,
  })),
  'procurement-requests': [
    ['code', 'code'],
    ['company', 'company'],
    ['requester', 'requester'],
    ['unit', 'unit'],
    ['usage', 'usage'],
    ['neededOn', 'neededOn'],
    ['status', 'reviewState'],
    ['identification', 'identificationState'],
    ['updatedAt', 'updatedAt'],
  ].map(([field, key]) => ({
    resource: 'purchase.request',
    field,
    titleKey: `procurement.requestUi.${key}`,
  })),
  'procurement-requests-detail': [
    ['company', 'company'],
    ['requester', 'requester'],
    ['unit', 'unit'],
    ['businessDate', 'businessDate'],
    ['sourceChannel', 'sourceChannel'],
    ['sourceRef', 'sourceRef'],
    ['sourceDoc', 'sourceDoc'],
    ['period', 'period'],
    ['neededOn', 'neededOn'],
    ['usage', 'usage'],
    ['notes', 'notes'],
  ].map(([field, key]) => ({
    resource: 'purchase.request',
    field,
    titleKey: `procurement.requestUi.${key}`,
  })),
  'procurement-suppliers-new': [
    {
      resource: 'procurement.supplier.base',
      field: 'notes',
      titleKey: 'procurement.notes',
    },
  ],
  'sales-customers-new': [
    {
      resource: 'sales.customer',
      field: 'notes',
      titleKey: 'procurement.notes',
    },
  ],
  ...Object.fromEntries(
    peopleKinds
      .filter((kind) => peopleFields[kind].length > 0)
      .map((kind) => [
        `people-${kind}-new`,
        peopleFields[kind].map((field) => ({
          resource: `people.${peopleResource(kind)}`,
          field: field.key,
          titleKey: `people.fields.${field.key}`,
        })),
      ]),
  ),
  ...Object.fromEntries(
    peopleKinds.flatMap((kind) => {
      const resource = `people.${peopleResource(kind)}`;
      return [
        [
          `people-${kind}`,
          peopleListFields(kind).map((field) => ({
            resource,
            field,
            titleKey: `people.fields.${field}`,
          })),
        ],
        ...(kind === 'profiles'
          ? []
          : [
              [
                `people-${kind}-detail`,
                peopleFields[kind].map((field) => ({
                  resource,
                  field: field.key,
                  titleKey: `people.fields.${field.key}`,
                })),
              ],
            ]),
      ];
    }),
  ),
  ...Object.fromEntries(
    executionPages.flatMap(({ page, kind }) => {
      const entries = [
        [
          page,
          executionListFields(kind).map((field) => ({
            resource: 'execution.document',
            field,
            titleKey: executionFieldTitle(field, kind),
          })),
        ],
        [
          `${page}-detail`,
          [
            ...executionDetailFields(kind).map((field) => ({
              resource: 'execution.document',
              field,
              titleKey: executionFieldTitle(field, kind),
            })),
            ...executionLineFields(kind).map((field) => ({
              resource: 'execution.document.line',
              field,
              titleKey: `execution.${field}`,
            })),
          ],
        ],
      ];
      return entries;
    }),
  ),
  'production-report': [
    {
      resource: 'production.report.downtime',
      field: 'impact',
      titleKey: 'production.downtimeImpact',
    },
    {
      resource: 'production.report.maintenance',
      field: 'assigneeName',
      titleKey: 'production.assignee',
    },
    {
      resource: 'production.report.overtime',
      field: 'type',
      titleKey: 'production.overtimeType',
    },
  ],
  'operations-targets': [
    ['actualValue', 'operations.actualValue'],
    ['achievementPct', 'operations.achievement'],
    ['progressPct', 'operations.progress'],
    ['varianceValue', 'operations.variance'],
    ['status', 'operations.status'],
    ['updatedAt', 'operations.updatedAt'],
  ].map(([field, key]) => ({
    resource: 'operations.target',
    field,
    titleKey: key,
  })),
  'operations-issues': [
    ['businessDate', 'operations.issueBusinessDate'],
    ['sourceType', 'operations.issueSourceLabel'],
  ].map(([field, key]) => ({
    resource: 'operations.issue',
    field,
    titleKey: key,
  })),
  'operations-overview': [
    'stockMetal',
    'stockSand',
    'salesOpen',
    'procurementOpen',
    'peopleActive',
    'issueOpen',
  ].map((field) => ({
    resource: 'operations.overview',
    field,
    titleKey: `operations.${field}`,
  })),
};

/** Required form fields stay visible; hiding them would make the page unsendable. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const pageFieldVisibilityRequiredFields: Readonly<
  Record<string, readonly string[]>
> = {
  'procurement-requests': ['purchase.request.code'],
  ...Object.fromEntries(
    peopleKinds.map((kind) => [
      `people-${kind}`,
      [`people.${peopleResource(kind)}.name`],
    ]),
  ),
  'procurement-suppliers-new': [
    'procurement.supplier.base.code',
    'procurement.supplier.base.name',
  ],
  'sales-customers-new': ['sales.customer.code', 'sales.customer.name'],
  'requisitions-purposes-new': ['issue.purpose.code', 'issue.purpose.name'],
  'procurement-requests-new': [
    'purchase.request.requesterEmployeeId',
    'purchase.request.requestingUnitId',
    'purchase.request.usage',
    'purchase.request.neededOn',
  ],
  ...Object.fromEntries(
    peopleKinds
      .filter((kind) => peopleFields[kind].length > 0)
      .map((kind) => [
        `people-${kind}-new`,
        peopleFields[kind]
          .filter((field) => field.required)
          .map((field) => `people.${peopleResource(kind)}.${field.key}`),
      ]),
  ),
  ...Object.fromEntries(
    organizationKinds.map((kind) => [
      `organization-${kind}-new`,
      organizationFields[kind]
        .filter((field) => field.required)
        .map(
          (field) => `organization.${organizationResource(kind)}.${field.key}`,
        ),
    ]),
  ),
  ...Object.fromEntries(
    materialKinds
      .filter((kind) => materialFields[kind].length > 0)
      .map((kind) => [
        `${materialPageId(kind)}-new`,
        materialFields[kind]
          .filter((field) => field.required)
          .map((field) => `materials.${materialResource(kind)}.${field.key}`),
      ]),
  ),
  'warehouse-material-templates-new': [
    'materials.template.key',
    'materials.template.title',
  ],
  'warehouse-materials-request-material': materialFields.requests
    .filter((field) => field.required)
    .map((field) => `materials.request.${field.key}`),
  'warehouse-material-requests-new-sku': materialFields.skus
    .filter((field) => field.required)
    .map((field) => `materials.sku.${field.key}`),
  'sales-price-lists': [
    'sales.priceList.customerId',
    'sales.priceList.skuId',
    'sales.priceList.unitPrice',
    'sales.priceList.effectiveFrom',
  ],
  'sales-orders-new': ['execution.document.currency'],
  'procurement-orders-new': ['execution.document.currency'],
  'warehouse-inbounds-new': ['execution.document.reason'],
  'warehouse-outbounds-new': ['execution.document.reason'],
  'warehouse-transfers-new': ['execution.document.reason'],
  'warehouse-counts-new': ['execution.document.reason'],
  ...Object.fromEntries(
    executionPages.flatMap(({ page }) => [
      ...executionNestedKinds.map((kind) => [
        `${page}-${kind}-new`,
        ['execution.document.reason'],
      ]),
      ...executionDocumentKinds.map((kind) => [
        `${page}-execution-document-${kind}`,
        ['execution.document.reason'],
      ]),
    ]),
  ),
  'production-report': [
    'production.report.material.quantity',
    'production.report.attendance.status',
    'production.report.downtime.startedAt',
    'production.report.downtime.description',
    'production.report.maintenance.description',
    'production.report.overtime.hours',
    'production.report.overtime.reason',
  ],
  'production-equipment': [
    'production.equipment.code',
    'production.equipment.name',
  ],
  'production-maintenance-plans': [
    'production.plan.name',
    'production.plan.type',
    'production.plan.intervalDays',
    'production.plan.nextDueOn',
  ],
  'production-downtime': [
    'production.downtime.endedAt',
    'production.downtime.resolution',
  ],
  'hse-incidents': [
    'hse.incident.occurredAt',
    'hse.incident.type',
    'hse.incident.severity',
    'hse.incident.location',
  ],
  'hse-hazards': [
    'hse.hazard.level',
    'hse.hazard.description',
    'hse.hazard.location',
    'hse.hazard.ownerName',
  ],
  'hse-certificates': [
    'hse.certificate.holderName',
    'hse.certificate.certType',
    'hse.certificate.certNo',
    'hse.certificate.expiresAt',
  ],
  'hse-inspections': ['hse.inspection.type', 'hse.inspection.plannedAt'],
  'hse-work-permits': [
    'hse.workPermit.permitNo',
    'hse.workPermit.type',
    'hse.workPermit.workDescription',
    'hse.workPermit.location',
    'hse.workPermit.validFrom',
    'hse.workPermit.validTo',
    'hse.workPermit.riskMeasures',
  ],
  'hse-training-records': [
    'hse.trainingRecord.personId',
    'hse.trainingRecord.courseType',
    'hse.trainingRecord.courseName',
    'hse.trainingRecord.completedAt',
  ],
  'hse-actions': [
    'hse.action.sourceType',
    'hse.action.sourceId',
    'hse.action.description',
    'hse.action.ownerId',
    'hse.action.ownerName',
  ],
  'operations-issues': [
    'operations.issue.title',
    'operations.issue.description',
    'operations.issue.ownerName',
    'operations.issue.resolution',
  ],
  'assets-list': ['people.assets.name'],
};

export function pageFieldVisibilityBaseKey(
  pageKey: string | undefined,
): string | undefined {
  if (!pageKey) return undefined;
  return pageFieldVisibilityInheritedFrom(pageKey) ?? pageKey;
}

export function supportsPageFieldVisibility(
  pageKey: string | undefined,
): boolean {
  // Any route with a page authz is configurable. The curated set below only
  // controls the default field list; it must never be a gate for new pages.
  return pageFieldVisibilityBaseKey(pageKey) !== undefined;
}

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
    executionPages.flatMap(({ page, kind, resource }) => [
      [page, executionListFields(kind).map((field) => `${resource}.${field}`)],
      [
        `${page}-detail`,
        executionDetailFields(kind).map((field) => `${resource}.${field}`),
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
    executionPages.flatMap(({ page, kind, resource }) => {
      const entries = [
        [
          page,
          executionListFields(kind).map((field) => ({
            resource,
            field,
            titleKey: executionFieldTitle(field, kind),
          })),
        ],
        [
          `${page}-detail`,
          executionDetailFields(kind).map((field) => ({
            resource,
            field,
            titleKey: executionFieldTitle(field, kind),
          })),
        ],
      ];
      return entries;
    }),
  ),
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
  const base = pageFieldVisibilityBaseKey(pageKey);
  return base !== undefined && pageFieldVisibilityPageKeys.has(base);
}

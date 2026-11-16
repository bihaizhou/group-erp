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

/**
 * Pages whose forms already read the page-level field visibility setting.
 * Only these pages may offer the per-page field editor; adding a page here
 * without wiring `usePageFieldVisibility` into its form would let an
 * administrator save a configuration that has no visible effect.
 */
export const pageFieldVisibilityPageKeys: ReadonlySet<string> = new Set([
  'procurement-requests-new',
  ...peopleKinds
    .filter((kind) => peopleFields[kind].length > 0)
    .map((kind) => `people-${kind}-new`),
  ...organizationKinds.map((kind) => `organization-${kind}-new`),
  ...materialKinds
    .filter((kind) => materialFields[kind].length > 0)
    .map((kind) => `${materialPageId(kind)}-new`),
  'sales-orders-new',
  'procurement-orders-new',
  'procurement-suppliers-new',
  'sales-customers-new',
  'warehouse-inbounds-new',
  'warehouse-outbounds-new',
  'warehouse-transfers-new',
  'warehouse-counts-new',
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
export const pageFieldVisibilityFields: Readonly<
  Record<string, readonly string[]>
> = {
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
  ...Object.fromEntries(
    Object.entries(executionDocumentFields).map(([pageKey, fields]) => [
      pageKey,
      fields.map((field) => `execution.document.${field}`),
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
};

/** Required form fields stay visible; hiding them would make the page unsendable. */
export const pageFieldVisibilityRequiredFields: Readonly<
  Record<string, readonly string[]>
> = {
  'procurement-suppliers-new': [
    'procurement.supplier.base.code',
    'procurement.supplier.base.name',
  ],
  'sales-customers-new': ['sales.customer.code', 'sales.customer.name'],
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
  'sales-orders-new': ['execution.document.currency'],
  'procurement-orders-new': ['execution.document.currency'],
  'warehouse-inbounds-new': ['execution.document.reason'],
  'warehouse-outbounds-new': ['execution.document.reason'],
  'warehouse-transfers-new': ['execution.document.reason'],
  'warehouse-counts-new': ['execution.document.reason'],
};

export function supportsPageFieldVisibility(
  pageKey: string | undefined,
): boolean {
  return pageKey !== undefined && pageFieldVisibilityPageKeys.has(pageKey);
}

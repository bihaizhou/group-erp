import {
  fields as organizationFields,
  kinds as organizationKinds,
} from '../organization/model.js';

/**
 * Pages whose forms already read the page-level field visibility setting.
 * Only these pages may offer the per-page field editor; adding a page here
 * without wiring `usePageFieldVisibility` into its form would let an
 * administrator save a configuration that has no visible effect.
 */
export const pageFieldVisibilityPageKeys: ReadonlySet<string> = new Set([
  'procurement-requests-new',
  'people-changes-new',
  ...organizationKinds.map((kind) => `organization-${kind}-new`),
]);

/**
 * Fields the page's form actually consults. Keeping this list beside the page
 * key stops the editor from offering a checkbox that would have no effect.
 */
export const pageFieldVisibilityFields: Readonly<
  Record<string, readonly string[]>
> = {
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
  'people-changes-new': [
    'people.change.personId',
    'people.change.type',
    'people.change.effectiveDate',
    'people.change.targetSubjectId',
    'people.change.targetPositionId',
    'people.change.changeEmployer',
    'people.change.assignmentId',
    'people.change.employmentType',
    'people.change.probationEnd',
    'people.change.contractEnd',
    'people.change.location',
    'people.change.explanation',
  ],
  ...Object.fromEntries(
    organizationKinds.map((kind) => [
      `organization-${kind}-new`,
      organizationFields[kind].map(
        (field) => `organization.${organizationResource(kind)}.${field.key}`,
      ),
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
  'people-changes-new': [
    ['personId', 'people.fields.personId'],
    ['type', 'people.fields.type'],
    ['effectiveDate', 'people.fields.effectiveDate'],
    ['targetSubjectId', 'people.fields.targetSubjectId'],
    ['targetPositionId', 'people.fields.targetPositionId'],
    ['changeEmployer', 'people.fields.changeEmployer'],
    ['assignmentId', 'people.fields.assignmentId'],
    ['employmentType', 'people.fields.employmentType'],
    ['probationEnd', 'people.fields.probationEnd'],
    ['contractEnd', 'people.fields.contractEnd'],
    ['location', 'people.fields.location'],
    ['explanation', 'people.fields.explanation'],
  ].map(([field, titleKey]) => ({
    resource: 'people.change',
    field,
    titleKey,
  })),
};

/** Required form fields stay visible; hiding them would make the page unsendable. */
export const pageFieldVisibilityRequiredFields: Readonly<
  Record<string, readonly string[]>
> = {
  'procurement-requests-new': [
    'purchase.request.requesterEmployeeId',
    'purchase.request.requestingUnitId',
    'purchase.request.usage',
    'purchase.request.neededOn',
  ],
  'people-changes-new': [
    'people.change.personId',
    'people.change.type',
    'people.change.effectiveDate',
    'people.change.explanation',
  ],
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
};

export function supportsPageFieldVisibility(
  pageKey: string | undefined,
): boolean {
  return pageKey !== undefined && pageFieldVisibilityPageKeys.has(pageKey);
}

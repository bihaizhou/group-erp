import { describe, expect, it } from 'vitest';
import {
  resolveAppClientContributions,
  type AppClientRegisteredRoute,
} from '@nocobase/app-client/plugins';
import applicationRoutes from '../../client/routes.js';
import {
  pageFieldVisibilityExtraFields,
  pageFieldVisibilityFields,
  pageFieldVisibilityPageKeys,
  pageFieldVisibilityRequiredFields,
  supportsPageFieldVisibility,
} from '../../client/pages/settings/page-field-visibility-pages.js';

const flatten = (
  routes: readonly AppClientRegisteredRoute[],
): AppClientRegisteredRoute[] =>
  routes.flatMap((route) => [route, ...flatten(route.children ?? [])]);

const application = resolveAppClientContributions([
  {
    packageName: 'page-field-coverage-app',
    source: 'application',
    routes: applicationRoutes,
  },
]);

describe('page field visibility registry', () => {
  it('covers every create route in the application', () => {
    const createRoutes = flatten(application.routes).filter(
      (route) =>
        Boolean(route.componentLoader) &&
        (route.path?.split('/').filter(Boolean).at(-1) ?? '').startsWith('new'),
    );
    expect(createRoutes.length).toBeGreaterThan(0);
    const uncovered = createRoutes
      .filter((route) => !supportsPageFieldVisibility(route.name))
      .map((route) => `${route.name} (${route.path})`);
    expect(uncovered).toEqual([]);
  });

  it('gives every supported page a non-empty field list', () => {
    for (const pageKey of pageFieldVisibilityPageKeys) {
      expect(
        pageFieldVisibilityFields[pageKey]?.length ?? 0,
        `${pageKey} has no fields`,
      ).toBeGreaterThan(0);
    }
  });

  it('keeps required fields inside the page field list', () => {
    for (const [pageKey, required] of Object.entries(
      pageFieldVisibilityRequiredFields,
    )) {
      expect(
        pageFieldVisibilityPageKeys.has(pageKey),
        `${pageKey} is required but not supported`,
      ).toBe(true);
      expect(
        required.every((field) =>
          pageFieldVisibilityFields[pageKey]?.includes(field),
        ),
        `${pageKey} requires a field it does not list`,
      ).toBe(true);
    }
  });

  it('registers JSON-backed people change fields as virtual fields', () => {
    expect(pageFieldVisibilityPageKeys.has('people-changes-new')).toBe(true);
    expect(pageFieldVisibilityFields['people-changes-new']).toContain(
      'people.change.location',
    );
    expect(pageFieldVisibilityExtraFields['people-changes-new']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resource: 'people.change',
          field: 'location',
          titleKey: 'people.fields.location',
        }),
      ]),
    );
  });

  it('covers material create pages and registers their fields', () => {
    for (const pageKey of [
      'warehouse-materials-new',
      'warehouse-material-names-new',
      'warehouse-materials-new',
      'warehouse-material-units-new',
      'warehouse-material-unitRules-new',
      'warehouse-material-references-new',
      'warehouse-material-tags-new',
      'warehouse-material-tagLinks-new',
      'warehouse-material-requests-new',
      'warehouse-material-warehouses-new',
    ]) {
      expect(pageFieldVisibilityPageKeys.has(pageKey)).toBe(true);
      expect(pageFieldVisibilityFields[pageKey]?.length ?? 0).toBeGreaterThan(
        0,
      );
    }
    expect(pageFieldVisibilityFields['warehouse-materials-new']).toContain(
      'materials.sku.materialNameId',
    );
    expect(pageFieldVisibilityExtraFields['warehouse-materials-new']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resource: 'materials.sku',
          field: 'materialNameId',
          titleKey: 'materials.fields.materialNameId',
        }),
      ]),
    );
  });

  it('covers the supplier create page and its extra note field', () => {
    expect(pageFieldVisibilityPageKeys.has('procurement-suppliers-new')).toBe(
      true,
    );
    expect(pageFieldVisibilityFields['procurement-suppliers-new']).toEqual([
      'procurement.supplier.base.code',
      'procurement.supplier.base.name',
      'procurement.supplier.base.registrationCode',
      'procurement.supplier.base.notes',
    ]);
    expect(pageFieldVisibilityExtraFields['procurement-suppliers-new']).toEqual(
      [
        expect.objectContaining({
          resource: 'procurement.supplier.base',
          field: 'notes',
          titleKey: 'procurement.notes',
        }),
      ],
    );
    expect(
      pageFieldVisibilityRequiredFields['procurement-suppliers-new'],
    ).toEqual([
      'procurement.supplier.base.code',
      'procurement.supplier.base.name',
    ]);
  });

  it('covers the sales customer create page that reuses the partner form', () => {
    expect(pageFieldVisibilityPageKeys.has('sales-customers-new')).toBe(true);
    expect(pageFieldVisibilityFields['sales-customers-new']).toEqual([
      'sales.customer.code',
      'sales.customer.name',
      'sales.customer.registrationCode',
      'sales.customer.notes',
    ]);
    expect(pageFieldVisibilityExtraFields['sales-customers-new']).toEqual([
      expect.objectContaining({
        resource: 'sales.customer',
        field: 'notes',
        titleKey: 'procurement.notes',
      }),
    ]);
    expect(pageFieldVisibilityRequiredFields['sales-customers-new']).toEqual([
      'sales.customer.code',
      'sales.customer.name',
    ]);
  });

  it('covers the requisition create page', () => {
    expect(pageFieldVisibilityPageKeys.has('requisitions-requests-new')).toBe(
      true,
    );
    expect(pageFieldVisibilityFields['requisitions-requests-new']).toEqual([
      'issue.request.notes',
    ]);
  });

  it('covers the requisition purpose create page', () => {
    expect(pageFieldVisibilityPageKeys.has('requisitions-purposes-new')).toBe(
      true,
    );
    expect(pageFieldVisibilityFields['requisitions-purposes-new']).toEqual([
      'issue.purpose.code',
      'issue.purpose.name',
      'issue.purpose.description',
    ]);
    expect(
      pageFieldVisibilityRequiredFields['requisitions-purposes-new'],
    ).toEqual(['issue.purpose.code', 'issue.purpose.name']);
  });

  it('covers every people create page from the shared field model', () => {
    for (const [kind, resource] of [
      ['employees', 'employee'],
      ['employments', 'employment'],
      ['assignments', 'assignment'],
      ['changes', 'change'],
      ['dimensions', 'dimension'],
      ['models', 'model'],
      ['profiles', 'profile'],
      ['evaluations', 'evaluation'],
      ['developmentPlans', 'developmentPlan'],
      ['workforcePlans', 'workforcePlan'],
    ]) {
      const pageKey = `people-${kind}-new`;
      expect(pageFieldVisibilityPageKeys.has(pageKey)).toBe(true);
      expect(pageFieldVisibilityFields[pageKey]?.length ?? 0).toBeGreaterThan(
        0,
      );
      expect(
        pageFieldVisibilityExtraFields[pageKey]?.every(
          (field) => field.resource === `people.${resource}`,
        ),
      ).toBe(true);
    }
    expect(pageFieldVisibilityFields['people-employees-new']).toContain(
      'people.employee.education',
    );
    expect(
      pageFieldVisibilityRequiredFields['people-evaluations-new'],
    ).toContain('people.evaluation.period');
  });

  it('covers sales and warehouse document create pages', () => {
    for (const pageKey of [
      'sales-orders-new',
      'procurement-orders-new',
      'warehouse-inbounds-new',
      'warehouse-outbounds-new',
      'warehouse-transfers-new',
      'warehouse-counts-new',
    ]) {
      expect(pageFieldVisibilityPageKeys.has(pageKey)).toBe(true);
      expect(pageFieldVisibilityFields[pageKey]).toContain(
        'execution.document.notes',
      );
    }
    expect(pageFieldVisibilityFields['sales-orders-new']).toContain(
      'execution.document.deliveryTerms',
    );
    expect(pageFieldVisibilityExtraFields['sales-orders-new']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resource: 'execution.document',
          field: 'deliveryTerms',
          titleKey: 'execution.deliveryTerms',
        }),
      ]),
    );
    expect(pageFieldVisibilityRequiredFields['sales-orders-new']).toContain(
      'execution.document.currency',
    );
    expect(
      pageFieldVisibilityRequiredFields['warehouse-inbounds-new'],
    ).toContain('execution.document.reason');
  });

  it('covers all six organization create pages with required identity fields', () => {
    for (const kind of [
      'subjects',
      'units',
      'positions',
      'sectors',
      'regions',
      'relations',
    ]) {
      const pageKey = `organization-${kind}-new`;
      expect(pageFieldVisibilityPageKeys.has(pageKey)).toBe(true);
      expect(pageFieldVisibilityFields[pageKey]).toContain(
        `organization.${kind.slice(0, -1)}.name`,
      );
      expect(pageFieldVisibilityRequiredFields[pageKey]).toContain(
        `organization.${kind.slice(0, -1)}.name`,
      );
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  pageFieldVisibilityExtraFields,
  pageFieldVisibilityFields,
  pageFieldVisibilityPageKeys,
  pageFieldVisibilityRequiredFields,
} from '../../client/pages/settings/page-field-visibility-pages.js';

describe('page field visibility registry', () => {
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

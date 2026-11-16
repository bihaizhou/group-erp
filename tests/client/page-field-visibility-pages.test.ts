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

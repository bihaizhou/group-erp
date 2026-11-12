import { describe, expect, it } from 'vitest';
import {
  buildFieldPolicies,
  fieldPolicyKey,
  type FieldPermissionResource,
} from '../../client/components/field-permission-policies.js';

const resources: FieldPermissionResource[] = [
  {
    resource: 'production.report.material',
    titleKey: 'production.reportOutput',
    descriptionKey: 'production.reportOutputHint',
    fields: [
      { field: 'quantity', label: '数量' },
      { field: 'bookQuantity', label: '账面库存' },
    ],
  },
  {
    resource: 'warehouse.inventory.balance',
    titleKey: 'execution.inventory',
    descriptionKey: 'execution.inventoryHint',
    fields: [{ field: 'available', label: '可用数量' }],
  },
];

describe('field permission policies', () => {
  it('stores only overrides and leaves write as the default', () => {
    expect(
      buildFieldPolicies(resources, (resource, field) =>
        fieldPolicyKey(resource, field) ===
        fieldPolicyKey('production.report.material', 'bookQuantity')
          ? 'hidden'
          : 'write',
      ),
    ).toEqual([
      {
        resource: 'production.report.material',
        field: 'bookQuantity',
        access: 'hidden',
      },
    ]);
  });

  it('covers every catalog resource so one page cannot erase another', () => {
    const policies = buildFieldPolicies(resources, () => 'readonly');
    expect(policies).toHaveLength(3);
    expect(policies.map((policy) => policy.resource)).toContain(
      'warehouse.inventory.balance',
    );
  });

  it('keeps hidden and readonly levels distinct', () => {
    const policies = buildFieldPolicies(resources, (resource, field) =>
      field === 'quantity'
        ? 'hidden'
        : field === 'available'
          ? 'readonly'
          : 'write',
    );
    expect(policies).toEqual([
      {
        resource: 'production.report.material',
        field: 'quantity',
        access: 'hidden',
      },
      {
        resource: 'warehouse.inventory.balance',
        field: 'available',
        access: 'readonly',
      },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  accessFor,
  redactRows,
  type FieldPolicyView,
} from '../../server/providers/field-access.js';

const policies: FieldPolicyView[] = [
  {
    resource: 'production.report.material',
    field: 'bookQuantity',
    access: 'hidden',
  },
  {
    resource: 'production.report.material',
    field: 'stockQuantity',
    access: 'visible',
  },
  {
    resource: 'production.report.material',
    field: 'quantity',
    access: 'write',
  },
];

describe('field access', () => {
  it('reports the configured access for a field', () => {
    expect(
      accessFor(policies, 'production.report.material', 'bookQuantity'),
    ).toBe('hidden');
    expect(
      accessFor(policies, 'production.report.material', 'stockQuantity'),
    ).toBe('visible');
    expect(accessFor(policies, 'production.report.material', 'quantity')).toBe(
      'write',
    );
  });

  it('keeps fields without a policy writable', () => {
    expect(accessFor(policies, 'production.report.material', 'notes')).toBe(
      'write',
    );
    expect(accessFor(policies, 'procurement.supplier', 'phone')).toBe('write');
  });

  it('removes hidden fields from rows without touching others', () => {
    const rows = [
      { code: 'A', reservedQuantity: '3', available: '7' },
      { code: 'B', reservedQuantity: '0', available: '9' },
    ];
    const redacted = redactRows(
      rows,
      [
        {
          resource: 'warehouse.inventory.balance',
          field: 'reservedQuantity',
          access: 'hidden',
        },
      ],
      'warehouse.inventory.balance',
    );
    expect(redacted).toEqual([
      { code: 'A', available: '7' },
      { code: 'B', available: '9' },
    ]);
    expect(rows[0]).toHaveProperty('reservedQuantity');
  });

  it('leaves rows alone when every field is visible', () => {
    const rows = [{ code: 'A', quantity: '1' }];
    expect(
      redactRows(
        rows,
        [
          {
            resource: 'warehouse.inventory.balance',
            field: 'reservedQuantity',
            access: 'visible',
          },
        ],
        'warehouse.inventory.balance',
      ),
    ).toEqual(rows);
  });

  it('does not let one resource leak into another', () => {
    expect(accessFor(policies, 'production.shiftReport', 'bookQuantity')).toBe(
      'write',
    );
  });
});

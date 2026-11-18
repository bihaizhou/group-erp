import { describe, expect, it } from 'vitest';
import { businessDate } from '../../server/providers/business-date.ts';
import {
  desiredPermissionKeys,
  expandMappings,
  isCurrentAssignment,
  type PositionAssignmentLike,
  type PositionMappingLike,
} from '../../server/providers/position-permission-sync.ts';

const assignments: PositionAssignmentLike[] = [
  { personId: 'p1', positionId: 'pos-a', status: 'active' },
  { personId: 'p1', positionId: 'pos-b', status: 'active' },
  { personId: 'p2', positionId: 'pos-c', status: 'active' },
];
const mappings: PositionMappingLike[] = [
  { positionId: 'pos-a', permissionSetKey: 'reader' },
  { positionId: 'pos-b', permissionSetKey: 'warehouse' },
  { positionId: 'pos-c', permissionSetKey: 'other' },
];

describe('position permission sync', () => {
  it('unions every active position held by the person', () => {
    expect(
      [...desiredPermissionKeys(['p1'], assignments, mappings)].sort(),
    ).toEqual(['reader', 'warehouse']);
  });

  it('ignores inactive assignments and other people', () => {
    expect([
      ...desiredPermissionKeys(
        ['p1'],
        [{ personId: 'p1', positionId: 'pos-a', status: 'ended' }],
        mappings,
      ),
    ]).toEqual([]);
    expect([...desiredPermissionKeys(['p9'], assignments, mappings)]).toEqual(
      [],
    );
  });

  // 2026-01-01T16:00:00Z is already 2026-01-02 00:00 in Asia/Shanghai, but
  // still 2026-01-01 in UTC — the exact drift the business-date fix guards.
  const aroundBeijingMidnight = new Date('2026-01-01T16:00:00.000Z');

  it('derives "today" from the business timezone, not UTC', () => {
    expect(businessDate('Asia/Shanghai', aroundBeijingMidnight)).toBe(
      '2026-01-02',
    );
    expect(aroundBeijingMidnight.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('counts an assignment starting on the business "today" as current', () => {
    const row: PositionAssignmentLike = {
      personId: 'p1',
      positionId: 'pos-a',
      status: 'active',
      data: { startDate: '2026-01-02' },
    };
    expect(
      isCurrentAssignment(
        row,
        businessDate('Asia/Shanghai', aroundBeijingMidnight),
      ),
    ).toBe(true);
    // The old UTC-derived date made the same assignment look like it starts
    // tomorrow, silently dropping the mapping for a full day.
    expect(
      isCurrentAssignment(
        row,
        aroundBeijingMidnight.toISOString().slice(0, 10),
      ),
    ).toBe(false);
  });

  it('treats endDate as exclusive for the business date', () => {
    const row: PositionAssignmentLike = {
      personId: 'p1',
      positionId: 'pos-a',
      status: 'active',
      data: { startDate: '2026-01-01', endDate: '2026-01-02' },
    };
    expect(isCurrentAssignment(row, '2026-01-01')).toBe(true);
    expect(isCurrentAssignment(row, '2026-01-02')).toBe(false);
  });

  it('honors the business-date asOf in desiredPermissionKeys', () => {
    const rows: PositionAssignmentLike[] = [
      {
        personId: 'p1',
        positionId: 'pos-a',
        status: 'active',
        data: { startDate: '2026-01-02' },
      },
    ];
    const asOf = businessDate('Asia/Shanghai', aroundBeijingMidnight);
    expect([...desiredPermissionKeys(['p1'], rows, mappings, asOf)]).toEqual([
      'reader',
    ]);
    expect([
      ...desiredPermissionKeys(
        ['p1'],
        rows,
        mappings,
        aroundBeijingMidnight.toISOString().slice(0, 10),
      ),
    ]).toEqual([]);
  });
});

describe('position template expansion', () => {
  it('unions template keys with the explicit mappings', () => {
    const expanded = expandMappings(
      [{ positionId: 'pos-a', permissionSetKey: 'reader' }],
      [{ id: 'pos-a', templateId: 'tpl-1' }],
      [{ id: 'tpl-1', permissionSetKeys: ['warehouse', 'report'] }],
    );
    expect(
      expanded
        .map(
          (row) => `${String(row.positionId)}:${String(row.permissionSetKey)}`,
        )
        .sort(),
    ).toEqual(['pos-a:reader', 'pos-a:report', 'pos-a:warehouse']);
  });

  it('does not duplicate a key that is both explicit and inherited', () => {
    const expanded = expandMappings(
      [{ positionId: 'pos-a', permissionSetKey: 'reader' }],
      [{ id: 'pos-a', templateId: 'tpl-1' }],
      [{ id: 'tpl-1', permissionSetKeys: ['reader'] }],
    );
    expect(expanded).toHaveLength(1);
  });

  it('ignores positions without a template and unknown template ids', () => {
    expect(
      expandMappings(
        [],
        [
          { id: 'pos-a', templateId: null },
          { id: 'pos-b', templateId: 'tpl-x' },
        ],
        [{ id: 'tpl-1', permissionSetKeys: ['reader'] }],
      ),
    ).toEqual([]);
  });

  it('accepts a JSON string for the stored template keys', () => {
    const expanded = expandMappings(
      [],
      [{ id: 'pos-a', templateId: 'tpl-1' }],
      [{ id: 'tpl-1', permissionSetKeys: '["reader"]' }],
    );
    expect(expanded).toEqual([
      { positionId: 'pos-a', permissionSetKey: 'reader' },
    ]);
  });

  it('feeds the desired keys of a holder through the expansion', () => {
    const expanded = expandMappings(
      mappings,
      [
        { id: 'pos-a', templateId: 'tpl-1' },
        { id: 'pos-b', templateId: null },
      ],
      [{ id: 'tpl-1', permissionSetKeys: ['report'] }],
    );
    expect(
      [...desiredPermissionKeys(['p1'], assignments, expanded)].sort(),
    ).toEqual(['reader', 'report', 'warehouse']);
  });
});

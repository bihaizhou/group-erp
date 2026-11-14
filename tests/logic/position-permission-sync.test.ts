import { describe, expect, it } from 'vitest';
import { businessDate } from '../../server/providers/business-date.ts';
import {
  desiredPermissionKeys,
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
    expect(
      aroundBeijingMidnight.toISOString().slice(0, 10),
    ).toBe('2026-01-01');
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
      isCurrentAssignment(row, aroundBeijingMidnight.toISOString().slice(0, 10)),
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

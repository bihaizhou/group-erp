import { describe, expect, it } from 'vitest';
import {
  desiredPermissionKeys,
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
});

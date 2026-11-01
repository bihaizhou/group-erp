import type { DatabaseConnection } from '@nocobase/db';

const text = (value: unknown) => (typeof value === 'string' ? value : '');

export interface PositionAssignmentLike {
  personId?: unknown;
  positionId?: unknown;
  status?: unknown;
  data?: { startDate?: unknown; endDate?: unknown } | string | null;
}

type AssignmentPeriod = { startDate?: unknown; endDate?: unknown };

function isAssignmentPeriod(value: unknown): value is AssignmentPeriod {
  return typeof value === 'object' && value !== null;
}

function assignmentData(row: PositionAssignmentLike): AssignmentPeriod {
  if (!row.data) return {};
  if (typeof row.data === 'string') {
    try {
      const parsed: unknown = JSON.parse(row.data);
      return isAssignmentPeriod(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return row.data;
}

export interface PositionMappingLike {
  positionId?: unknown;
  permissionSetKey?: unknown;
}

/**
 * Keys derived from a person's active assignments.
 *
 * A person can hold several positions; the union is intentional, matching the
 * position-permission page's "one position = several permission sets" model.
 */
export function isCurrentAssignment(
  row: PositionAssignmentLike,
  asOf = new Date().toISOString().slice(0, 10),
): boolean {
  if (row.status !== undefined && row.status !== 'active') return false;
  const data = assignmentData(row);
  const startDate = text(data.startDate);
  const endDate = text(data.endDate);
  return (!startDate || startDate <= asOf) && (!endDate || endDate > asOf);
}

export function desiredPermissionKeys(
  personIds: readonly string[],
  assignments: readonly PositionAssignmentLike[],
  mappings: readonly PositionMappingLike[],
  asOf = new Date().toISOString().slice(0, 10),
): Set<string> {
  const people = new Set(personIds);
  const positions = new Set(
    assignments
      .filter((row) => people.has(text(row.personId)))
      .filter((row) => isCurrentAssignment(row, asOf))
      .map((row) => text(row.positionId))
      .filter(Boolean),
  );
  return new Set(
    mappings
      .filter((row) => positions.has(text(row.positionId)))
      .map((row) => text(row.permissionSetKey))
      .filter(Boolean),
  );
}

/**
 * Reconcile an account's permission-set assignments with the positions it
 * currently holds. Only keys that are configured on some position are
 * candidates for removal, so unrelated manual grants survive.
 */
export async function syncAccountPositionPermissions(
  db: DatabaseConnection,
  accountId: string,
): Promise<{ granted: number; revoked: number }> {
  if (!accountId) return { granted: 0, revoked: 0 };
  const employees = await db
    .repository('personnelEmployees')
    .findMany({ filter: { accountId }, limit: 100 });
  const personIds = employees
    .filter((row) => row.status === 'active')
    .map((row) => text(row.id))
    .filter(Boolean);
  if (personIds.length === 0) return { granted: 0, revoked: 0 };

  const [assignments, mappings, current] = await Promise.all([
    db
      .repository('personnelAssignments')
      .findMany({ filter: { status: 'active' }, limit: 10000 }),
    db.repository('orgPositionPermissionSets').findMany({ limit: 10000 }),
    db
      .repository('authorizationPermissionSetAssignments')
      .findMany({
        filter: { subjectType: 'user', subjectId: accountId },
        limit: 10000,
      }),
  ]);
  const desired = desiredPermissionKeys(personIds, assignments, mappings);
  const mappedKeys = new Set(
    mappings.map((row) => text(row.permissionSetKey)).filter(Boolean),
  );
  const currentKeys = new Set(
    current.map((row) => text(row.permissionSetKey)).filter(Boolean),
  );

  let granted = 0;
  let revoked = 0;
  const now = new Date();
  for (const key of currentKeys) {
    if (!mappedKeys.has(key) || desired.has(key)) continue;
    await db.repository('authorizationPermissionSetAssignments').deleteMany({
      filter: {
        subjectType: 'user',
        subjectId: accountId,
        permissionSetKey: key,
      },
    });
    revoked += 1;
  }
  for (const key of desired) {
    if (currentKeys.has(key)) continue;
    await db.repository('authorizationPermissionSetAssignments').createOne({
      values: {
        id: `user:${accountId}:${key}`,
        subjectType: 'user',
        subjectId: accountId,
        permissionSetKey: key,
        createdAt: now,
        updatedAt: now,
      },
    });
    granted += 1;
  }
  return { granted, revoked };
}

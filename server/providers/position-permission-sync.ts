import type { DatabaseConnection } from '@nocobase/db';
import { businessDate } from './business-date.js';

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

export interface PositionLike {
  id?: unknown;
  templateId?: unknown;
}

export interface PositionTemplateLike {
  id?: unknown;
  permissionSetKeys?: unknown;
}

function keyList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Explicit position mappings plus the keys inherited from each position's
 * template. Templates never replace the explicit mapping table: both are
 * unioned, so a position can carry a job-family default and a few extras.
 */
export function expandMappings(
  mappings: readonly PositionMappingLike[],
  positions: readonly PositionLike[],
  templates: readonly PositionTemplateLike[],
): PositionMappingLike[] {
  const templatesById = new Map(
    templates.map((template) => [text(template.id), template]),
  );
  const expanded = [...mappings];
  const seen = new Set(
    mappings.map(
      (row) => `${text(row.positionId)}\u0000${text(row.permissionSetKey)}`,
    ),
  );
  for (const position of positions) {
    const template = templatesById.get(text(position.templateId));
    if (!template) continue;
    const positionId = text(position.id);
    for (const key of keyList(template.permissionSetKeys)) {
      const id = `${positionId}\u0000${key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      expanded.push({ positionId, permissionSetKey: key });
    }
  }
  return expanded;
}

/**
 * Keys derived from a person's active assignments.
 *
 * A person can hold several positions; the union is intentional, matching the
 * position-permission page's "one position = several permission sets" model.
 *
 * `asOf` is a civil business date in the configured people timezone — the
 * server's OS/UTC date must not decide whether an assignment counts "today".
 */
export function isCurrentAssignment(
  row: PositionAssignmentLike,
  asOf = businessDate(),
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
  asOf = businessDate(),
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
 * currently holds. Only keys that are configured on some position — or keys
 * explicitly named as coming from the position being edited — are candidates
 * for removal, so unrelated manual grants survive. The explicit list matters
 * when a template is unlinked: its keys are no longer mapped anywhere, and
 * without it the stale assignments would survive forever.
 */
export async function syncAccountPositionPermissions(
  db: DatabaseConnection,
  accountId: string,
  timeZone = 'Asia/Shanghai',
  revokeKeys: Iterable<string> = [],
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

  const [assignments, mappings, positions, templates, current] =
    await Promise.all([
      db
        .repository('personnelAssignments')
        .findMany({ filter: { status: 'active' }, limit: 10000 }),
      db.repository('orgPositionPermissionSets').findMany({ limit: 10000 }),
      db.repository('orgPositions').findMany({ limit: 10000 }),
      db.repository('orgPositionTemplates').findMany({ limit: 2000 }),
      db.repository('authorizationPermissionSetAssignments').findMany({
        filter: { subjectType: 'user', subjectId: accountId },
        limit: 10000,
      }),
    ]);
  const effective = expandMappings(mappings, positions, templates);
  const desired = desiredPermissionKeys(
    personIds,
    assignments,
    effective,
    businessDate(timeZone),
  );
  const mappedKeys = new Set(
    effective.map((row) => text(row.permissionSetKey)).filter(Boolean),
  );
  const removalCandidates = new Set(mappedKeys);
  for (const key of revokeKeys) if (key) removalCandidates.add(key);
  const currentKeys = new Set(
    current.map((row) => text(row.permissionSetKey)).filter(Boolean),
  );

  let granted = 0;
  let revoked = 0;
  const now = new Date();
  for (const key of currentKeys) {
    if (!removalCandidates.has(key) || desired.has(key)) continue;
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

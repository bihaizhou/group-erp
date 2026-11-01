import type { DatabaseConnection } from '@nocobase/db';

/** Integrity-only check inside the caller's organization transaction; never exposes other users' requests. */
export async function hasOpenIssueOrganizationReferences(
  c: DatabaseConnection,
  kind: 'subjects' | 'units',
  targetId: string,
) {
  return c.repository('materialIssueRequests').exists({
    filter: (f) =>
      f.and([
        f
          .string(kind === 'subjects' ? 'subjectId' : 'requestingUnitId')
          .eq(targetId),
        f.or(
          ['draft', 'pending', 'approved'].map((status) =>
            f.string('status').eq(status),
          ),
        ),
      ]),
  });
}

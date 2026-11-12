import type { DatabaseManager } from '@nocobase/db';

/**
 * Super administrators hold the root permission set, which the authorization
 * layer treats as unrestricted. Business pages still need a person behind the
 * account (employment, position, unit), so those pages ask this helper whether
 * the caller is the platform administrator instead of a staff member.
 */
export async function isSuperAdmin(
  database: DatabaseManager,
  principal: { type?: string; id?: string },
): Promise<boolean> {
  if (principal.type && principal.type !== 'user') return false;
  if (!principal.id) return false;
  const rows = await database
    .repository('authorizationPermissionSetAssignments')
    .findMany({
      filter: (filter) =>
        filter.and([
          filter.string('subjectType').eq('user'),
          filter.string('subjectId').eq(principal.id!),
          filter.string('permissionSetKey').eq('root'),
        ]),
      limit: 1,
    });
  return rows.length > 0;
}

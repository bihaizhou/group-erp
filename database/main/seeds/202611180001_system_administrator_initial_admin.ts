import { defineSeed, type SeedContext } from '@nocobase/db';

/**
 * Grants the permission-management role to the configured initial administrator.
 *
 * 202611110002_system_administrator looked the Super Admin up by the literal
 * username `nocobase`. Deployments that set INITIAL_ADMIN_USERNAME (the
 * production compose uses `admin`) therefore never assigned the
 * `system-administrator` set: the account could only reach the permission
 * screens while it also held the platform `root` set, and a fresh installation
 * whose root seed could not match `nocobase` was left with no administrator for
 * permission management at all. Resolve the account the same way the platform
 * root-set seed does, so both defaults agree.
 */
const KEY = 'system-administrator';
const DEFAULT_INITIAL_ADMIN = 'nocobase';

export default defineSeed({
  name: '202611180001_system_administrator_initial_admin',
  transaction: true,
  async run({ config, repository, query }: SeedContext) {
    const configured = config.get<string>('users.initialAdmin.username');
    const username = String(configured ?? DEFAULT_INITIAL_ADMIN)
      .trim()
      .toLowerCase();
    const admin = await query
      .selectFrom('user')
      .select('id')
      .where('username', '=', username)
      .limit(1)
      .executeTakeFirst();
    if (!admin) return;
    // The set is created by 202611110002_system_administrator; never leave an
    // assignment pointing at a key that does not exist.
    const role = await repository('authorizationPermissionSets').findOne({
      filter: { key: KEY },
    });
    if (!role) return;
    const userId = String(admin.id);
    const assignmentId = `user:${userId}:${KEY}`;
    const assigned = await repository(
      'authorizationPermissionSetAssignments',
    ).findOne({ filter: { id: assignmentId } });
    if (assigned) return;
    const now = new Date();
    await query
      .insertInto('authorizationPermissionSetAssignments')
      .values({
        id: assignmentId,
        subjectType: 'user',
        subjectId: userId,
        permissionSetKey: KEY,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  },
});

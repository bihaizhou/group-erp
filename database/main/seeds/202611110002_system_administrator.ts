import { randomUUID } from 'node:crypto';
import { defineSeed, type SeedContext } from '@nocobase/db';

/**
 * A permission-set administrator: the one role that may open Permission Sets
 * and edit their page, action and field grants. The Super Admin account gets it
 * so a fresh installation can always reach the configuration screens.
 */
const KEY = 'system-administrator';

const GRANTS = [
  {
    resource: { type: 'settings', id: 'authorization.permission-sets' },
    actions: [{ action: 'read' }, { action: 'create' }, { action: 'update' }],
  },
  {
    resource: { type: 'settings', id: 'authorization.default-access' },
    actions: [
      { action: 'read' },
      { action: 'create' },
      { action: 'update' },
      { action: 'delete' },
    ],
  },
];

export default defineSeed({
  name: '202611110002_system_administrator',
  transaction: true,
  async run({ repository, query }: Pick<SeedContext, 'repository' | 'query'>) {
    const existing = await repository('authorizationPermissionSets').findOne({
      filter: { key: KEY },
    });
    if (!existing) {
      const now = new Date();
      await query.insertInto('authorizationPermissionSets').values({
        id: randomUUID(),
        key: KEY,
        title: JSON.stringify('系统管理员'),
        grants: JSON.stringify(GRANTS),
        revision: randomUUID(),
        createdAt: now,
        updatedAt: now,
      }).execute();
    }
    const admin = await query
      .selectFrom('user')
      .select('id')
      .where('username', '=', 'nocobase')
      .limit(1)
      .executeTakeFirst();
    if (!admin) return;
    const userId = String(admin.id);
    const assignmentId = `user:${userId}:${KEY}`;
    const assigned = await repository(
      'authorizationPermissionSetAssignments',
    ).findOne({ filter: { id: assignmentId } });
    if (assigned) return;
    const now = new Date();
    await query.insertInto('authorizationPermissionSetAssignments').values({
      id: assignmentId,
      subjectType: 'user',
      subjectId: userId,
      permissionSetKey: KEY,
      createdAt: now,
      updatedAt: now,
    }).execute();
  },
});

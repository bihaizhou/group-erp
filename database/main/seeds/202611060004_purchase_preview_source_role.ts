import { randomUUID } from 'node:crypto';
import { defineSeed } from '@nocobase/db';

export default defineSeed({
  name: '202611060004_purchase_preview_source_role',
  transaction: false,
  async run({ query }) {
    const user = await query
      .selectFrom('user')
      .select('id')
      .where('email', '=', 'buyer@demo.example')
      .executeTakeFirst();
    if (!user) return;
    const subjectId = String(user.id),
      role = 'procurement-source-requester',
      existing = await query
        .selectFrom('authorizationPermissionSetAssignments')
        .select('id')
        .where('permissionSetKey', '=', role)
        .where('subjectType', '=', 'user')
        .where('subjectId', '=', subjectId)
        .executeTakeFirst();
    if (existing) return;
    await query
      .insertInto('authorizationPermissionSetAssignments')
      .values({
        id: randomUUID(),
        subjectType: 'user',
        subjectId,
        permissionSetKey: role,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute();
  },
});

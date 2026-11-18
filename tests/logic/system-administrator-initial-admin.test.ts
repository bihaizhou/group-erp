import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import { createStandaloneServer } from '../../server/standalone.js';

// The production compose configures the Super Admin as `admin`, not the
// template's `nocobase`; the seed must follow the configuration, not a literal.
const INITIAL_ADMIN = {
  username: 'deployadmin',
  email: 'deployadmin@example.test',
  password: 'Deploy-admin-123!',
};

const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    app: { publicOrigin: 'http://localhost' },
    auth: { secret: 'test-auth-secret-at-least-32-characters' },
    users: { initialAdmin: INITIAL_ADMIN },
  },
});

test('the configured initial administrator receives the permission-management role', async ({
  connection,
}) => {
  const admin = await connection.query
    .selectFrom('user')
    .select(['id'])
    .where('username', '=', INITIAL_ADMIN.username)
    .executeTakeFirstOrThrow();
  const assignment = await connection.query
    .selectFrom('authorizationPermissionSetAssignments')
    .select(['id'])
    .where('subjectId', '=', String(admin.id))
    .where('permissionSetKey', '=', 'system-administrator')
    .executeTakeFirst();
  expect(
    assignment?.id,
    'The permission-management role must follow users.initialAdmin.username; a hard-coded `nocobase` lookup leaves deployments such as the production `admin` account without it.',
  ).toBe(`user:${admin.id}:system-administrator`);
});

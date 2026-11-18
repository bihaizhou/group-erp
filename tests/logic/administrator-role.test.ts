import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import { createStandaloneServer } from '../../server/standalone.js';

// Same configuration the production compose uses: the Super Admin is not
// necessarily the template's `nocobase`.
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

test('the configured initial administrator receives the business administrator role', async ({
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
    .where('permissionSetKey', '=', 'administrator')
    .executeTakeFirst();
  expect(
    assignment?.id,
    'The business administrator must reach the configured initial admin, not a hard-coded `nocobase` account.',
  ).toBe(`user:${admin.id}:administrator`);
});

test('the administrator role covers every business page and action without granting permission management', async ({
  connection,
}) => {
  const role = await connection.query
    .selectFrom('authorizationPermissionSets')
    .select(['grants'])
    .where('key', '=', 'administrator')
    .executeTakeFirstOrThrow();
  const grants = (
    typeof role.grants === 'string' ? JSON.parse(role.grants) : role.grants
  ) as {
    resource: { type: string; id: string };
    actions: { action: string; policy?: unknown }[];
  }[];

  const pages = grants.filter((grant) => grant.resource.type === 'page');
  const composites = grants.filter(
    (grant) => grant.resource.type === 'composite',
  );
  const settings = grants.filter((grant) => grant.resource.type === 'settings');

  expect(pages).toHaveLength(80);
  expect(composites).toHaveLength(40);
  expect(settings.map((grant) => grant.resource.id).sort()).toEqual([
    'assets',
    'hse',
    'operations',
    'organization',
    'personnel.accountBinding',
    'personnel.sensitive',
    'production',
  ]);
  for (const grant of pages)
    expect(grant.actions).toEqual([{ action: 'access' }]);
  // A composite action without a policy stays unrestricted: the authorizer
  // expands it with no record filter. Explicit record scopes would narrow it.
  for (const grant of composites)
    for (const action of grant.actions) expect(action.policy).toBeUndefined();
  expect(
    settings.some((grant) => grant.resource.id.startsWith('authorization.')),
    'Permission management belongs to system-administrator, not this role.',
  ).toBe(false);
});

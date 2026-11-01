// @vitest-environment node
import { randomUUID, randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import {
  findUndeclaredApiRoutes,
  apiDocsToken,
  findApiDocumentSchemaProblems,
} from '@nocobase/app-server/router';
import { createStandaloneServer } from '../../server/standalone.js';

const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    app: { publicOrigin: 'http://localhost' },
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    jobs: { default: 'memory' },
    queue: { default: 'memory' },
    logging: { console: { enabled: false }, file: { enabled: false } },
  },
});

test('enforces authentication, independent read/write permissions, and revocation', async ({
  testApp,
  request,
}) => {
  expect((await request('/organization/subjects')).status).toBe(401);
  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const password = randomUUID();
  const email = `org-${randomUUID()}@example.test`;
  const user = await users.create({
    name: 'Organization test reader',
    email,
    password,
  });
  const member = await signIn(testApp, { email, password });
  expect((await member.fetch('/organization/subjects')).status).toBe(403);
  const authz = testApp.application.container.resolve(authorizationToken);
  const assignment = await authz.permissionSets.assign({
    permissionSet: 'organization-reader',
    subject: { type: 'user', id: user.id },
  });
  expect((await member.fetch('/organization/subjects')).status).toBe(200);
  const denied = await member.fetch('/organization/sectors', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({ unknownField: true }),
  });
  expect(denied.status).toBe(403); // Authorization precedes input validation.
  await authz.permissionSets.revoke(assignment.id);
  expect((await member.fetch('/organization/subjects')).status).toBe(403);
});

test('maintains organization structure, rejects invalid changes and commits audit atomically', async ({
  testApp,
  database,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const send = async (path: string, body: unknown, method = 'POST') =>
    admin.fetch(`/organization/${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
  const create = async (kind: string, body: unknown) => {
    const response = await send(kind, body);
    const payload = await response.json();
    expect(response.status).toBe(201);
    return payload.data;
  };
  const sector = await create('sectors', {
    name: 'Test energy',
    code: 'TEST-ENERGY',
  });
  const group = await create('subjects', {
    name: 'Test group',
    code: 'TEST-GROUP',
    type: 'group',
  });
  const company = await create('subjects', {
    name: 'Test company',
    code: 'TEST-CO',
    type: 'company',
    parentId: group.id,
    sectorId: sector.id,
    regionId: '00000000-0000-4000-8000-000000000001',
  });
  expect(
    (
      await send('subjects', {
        name: 'Missing classification',
        code: 'BAD-CO',
        type: 'company',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await send('subjects', {
        name: 'Personnel injection',
        code: 'BAD-PERSON',
        type: 'group',
        employeeId: 'someone',
      })
    ).status,
  ).toBe(400);
  expect(
    (await send('sectors', { name: 'Duplicate', code: 'TEST-ENERGY' })).status,
  ).toBe(409);
  const unit = await create('units', {
    name: 'Test finance',
    code: 'TEST-FIN',
    type: 'department',
    subjectId: company.id,
  });
  const other = await create('units', {
    name: 'Group finance',
    code: 'TEST-GFIN',
    type: 'department',
    subjectId: group.id,
  });
  expect(
    (
      await send(
        `units/${unit.id}`,
        {
          version: unit.version,
          reason: 'Invalid cross-company parent',
          parentId: other.id,
        },
        'PATCH',
      )
    ).status,
  ).toBe(400);
  const position = await create('positions', {
    name: 'Test finance manager',
    code: 'TEST-FM',
    unitId: unit.id,
  });
  const positionPermissions = await admin.fetch('/position-permissions');
  expect(positionPermissions.status).toBe(200);
  const permissionData = (await positionPermissions.json()).data;
  expect(permissionData.positions).toContainEqual(
    expect.objectContaining({ id: position.id, permissionSetKeys: [] }),
  );
  const savePositionPermissions = await admin.fetch(
    `/position-permissions/${position.id}`,
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ permissionSetKeys: ['organization-reader'] }),
    },
  );
  expect(savePositionPermissions.status).toBe(200);
  const savedPermissions = await admin.fetch('/position-permissions');
  expect(
    (await savedPermissions.json()).data.positions.find(
      (row: { id: string }) => row.id === position.id,
    ),
  ).toMatchObject({ permissionSetKeys: ['organization-reader'] });
  const updated = await send(
    `units/${unit.id}`,
    {
      version: unit.version,
      reason: 'Define responsible position',
      leaderPositionId: position.id,
    },
    'PATCH',
  );
  expect(updated.status).toBe(200);
  expect(
    (
      await send(
        `units/${unit.id}`,
        {
          version: unit.version,
          reason: 'Stale change',
          name: 'Do not overwrite',
        },
        'PATCH',
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await send(
        `subjects/${group.id}`,
        {
          version: group.version,
          reason: 'Cycle attempt',
          parentId: company.id,
        },
        'PATCH',
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await send(`subjects/${company.id}/setStatus`, {
        version: company.version,
        reason: 'Still has units',
        status: 'inactive',
      })
    ).status,
  ).toBe(400);
  const relation = await create('relations', {
    name: 'Group procurement service',
    code: 'TEST-SVC',
    type: 'service',
    sourceKind: 'subjects',
    sourceId: group.id,
    targetKind: 'subjects',
    targetId: company.id,
    startDate: '2026-10-16',
  });
  expect(relation.id).toBeTruthy();
  expect(
    (
      await send('relations', {
        name: 'Self',
        code: 'BAD-SELF',
        type: 'service',
        sourceKind: 'subjects',
        sourceId: group.id,
        targetKind: 'subjects',
        targetId: group.id,
        startDate: '2026-10-16',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await send('relations', {
        name: 'Dates',
        code: 'BAD-DATE',
        type: 'service',
        sourceKind: 'subjects',
        sourceId: group.id,
        targetKind: 'subjects',
        targetId: company.id,
        startDate: '2026-10-16',
        endDate: '2026-10-15',
      })
    ).status,
  ).toBe(400);
  const audit = await (
    await admin.fetch('/organization/history?pageSize=100')
  ).json();
  expect(audit.data).toHaveLength(8);
  expect(
    audit.data.some(
      (row: { reason: string }) => row.reason === 'Cycle attempt',
    ),
  ).toBe(false);
  expect(
    audit.data.some(
      (row: { reason: string }) => row.reason === 'Define responsible position',
    ),
  ).toBe(true);
  expect(await database.repository('orgSubjects').count()).toBe(2);
  const list = await (
    await admin.fetch('/organization/subjects?q=test&pageSize=1')
  ).json();
  expect(list.data).toHaveLength(1);
  expect(list.meta.total).toBe(2);
  const tree = await (await admin.fetch('/organization/tree')).json();
  expect(tree.data.subjects.total).toBe(2);
  expect(tree.data.positions.total).toBe(1);
  expect(
    (
      await admin.fetch(`/organization/subjects/${company.id}`, {
        method: 'DELETE',
        headers: { origin: 'http://localhost' },
      })
    ).status,
  ).toBe(404);
});

test('declares all organization endpoints with valid API schemas', async ({
  testApp,
}) => {
  expect(findUndeclaredApiRoutes(testApp.application)).toEqual([]);
  const document = await testApp.application.container
    .resolve(apiDocsToken)
    .getDocument();
  expect(findApiDocumentSchemaProblems(document)).toEqual([]);
  expect(document.paths?.['/api/organization/subjects']?.get?.operationId).toBe(
    'listOrganizationsubjects',
  );
});

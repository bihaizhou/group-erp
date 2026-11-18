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
import {
  ORG_MUTATION_LOCK_ID,
  lockOrgMutation,
} from '../../server/providers/organization-service.js';
import type { DatabaseConnection } from '@nocobase/db';

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
  // A position template is a reusable bundle of sets; linking it to a
  // position makes every holder inherit the template keys as well.
  const templatePayload = {
    code: 'TEST-TPL',
    name: 'Test template',
    permissionSetKeys: ['organization-reader'],
  };
  const templateResponse = await admin.fetch(
    '/position-permissions/templates',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(templatePayload),
    },
  );
  expect(templateResponse.status).toBe(200);
  const template = (await templateResponse.json()).data as {
    id: string;
    code: string;
  };
  expect(template).toMatchObject({ code: 'TEST-TPL' });
  for (const permissionSetKeys of [['root'], ['does-not-exist']]) {
    expect(
      (
        await admin.fetch('/position-permissions/templates', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost',
          },
          body: JSON.stringify({
            ...templatePayload,
            code: `TEST-BAD-${permissionSetKeys[0]}`,
            permissionSetKeys,
          }),
        })
      ).status,
    ).toBe(400);
  }
  const linkTemplate = await admin.fetch(
    `/position-permissions/${position.id}/template`,
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ templateId: template.id }),
    },
  );
  expect(linkTemplate.status).toBe(200);
  const templatePermissions = (
    await (await admin.fetch('/position-permissions')).json()
  ).data;
  expect(
    templatePermissions.positions.find(
      (row: { id: string }) => row.id === position.id,
    ),
  ).toMatchObject({
    templateId: template.id,
    templateKeys: ['organization-reader'],
  });
  expect(templatePermissions.templates).toContainEqual(
    expect.objectContaining({ id: template.id, positionCount: 1 }),
  );
  const deleteLinkedTemplate = await admin.fetch(
    `/position-permissions/templates/${template.id}`,
    { method: 'DELETE', headers: { origin: 'http://localhost' } },
  );
  expect(deleteLinkedTemplate.status).toBe(400);
  const unlinkTemplate = await admin.fetch(
    `/position-permissions/${position.id}/template`,
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ templateId: null }),
    },
  );
  expect(unlinkTemplate.status).toBe(200);
  const deleteTemplate = await admin.fetch(
    `/position-permissions/templates/${template.id}`,
    { method: 'DELETE', headers: { origin: 'http://localhost' } },
  );
  expect(deleteTemplate.status).toBe(200);
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

test('guards deactivation against residual permission mappings and asset references', async ({
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
  const putPermissions = (positionId: string, permissionSetKeys: string[]) =>
    admin.fetch(`/position-permissions/${positionId}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ permissionSetKeys }),
    });
  const errorOf = async (response: Awaited<ReturnType<typeof admin.fetch>>) =>
    (await response.json()).error;
  const sector = await create('sectors', {
    name: 'Guard energy',
    code: 'GUARD-ENERGY',
  });
  const company = await create('subjects', {
    name: 'Guard company',
    code: 'GUARD-CO',
    type: 'company',
    sectorId: sector.id,
    regionId: '00000000-0000-4000-8000-000000000001',
  });
  const unit = await create('units', {
    name: 'Guard unit',
    code: 'GUARD-UNIT',
    type: 'department',
    subjectId: company.id,
  });
  const position = await create('positions', {
    name: 'Guard manager',
    code: 'GUARD-MGR',
    unitId: unit.id,
  });
  expect(
    (await putPermissions(position.id, ['organization-reader'])).status,
  ).toBe(200);

  // A position with a residual mapping cannot be deactivated.
  const deactivateMapped = await send(`positions/${position.id}/setStatus`, {
    version: position.version,
    reason: 'Mapping still attached',
    status: 'inactive',
  });
  expect(deactivateMapped.status).toBe(400);
  expect((await errorOf(deactivateMapped)).reason).toBe(
    'ORG_POSITION_MAPPING_DEPENDENTS',
  );

  // A legacy mapping row under an already-inactive position still blocks
  // deactivating the unit that holds the position.
  const spareUnit = await create('units', {
    name: 'Guard spare unit',
    code: 'GUARD-UNIT2',
    type: 'department',
    subjectId: company.id,
  });
  const spare = await create('positions', {
    name: 'Guard spare',
    code: 'GUARD-SPARE',
    unitId: spareUnit.id,
  });
  expect(
    (
      await send(`positions/${spare.id}/setStatus`, {
        version: spare.version,
        reason: 'Vacant',
        status: 'inactive',
      })
    ).status,
  ).toBe(200);
  await database.repository('orgPositionPermissionSets').createOne({
    values: {
      id: randomUUID(),
      positionId: spare.id,
      permissionSetKey: 'organization-reader',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const deactivateUnit = await send(`units/${spareUnit.id}/setStatus`, {
    version: spareUnit.version,
    reason: 'Legacy mapping below',
    status: 'inactive',
  });
  expect(deactivateUnit.status).toBe(400);
  expect((await errorOf(deactivateUnit)).reason).toBe(
    'ORG_POSITION_MAPPING_DEPENDENTS',
  );

  // Saving a mapping for an inactive position is refused and writes nothing.
  const saveInactive = await putPermissions(spare.id, ['organization-reader']);
  expect(saveInactive.status).toBe(400);
  expect((await errorOf(saveInactive)).reason).toBe('ORG_POSITION_NOT_ACTIVE');
  expect(
    await database
      .repository('orgPositionPermissionSets')
      .count({ filter: { positionId: spare.id } }),
  ).toBe(1);

  // A subject referenced by a registered asset cannot be deactivated.
  const holding = await create('subjects', {
    name: 'Guard holding company',
    code: 'GUARD-HOLD',
    type: 'company',
    sectorId: sector.id,
    regionId: '00000000-0000-4000-8000-000000000001',
  });
  await database.repository('assets').createOne({
    values: {
      id: randomUUID(),
      subjectId: holding.id,
      code: 'GUARD-AST-1',
      name: 'Guard registered asset',
      status: 'in_stock',
      currency: 'CNY',
      version: 1,
      createdBy: 'test',
      updatedBy: 'test',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const deactivateHolding = await send(`subjects/${holding.id}/setStatus`, {
    version: holding.version,
    reason: 'Asset still registered',
    status: 'inactive',
  });
  expect(deactivateHolding.status).toBe(400);
  expect((await errorOf(deactivateHolding)).reason).toBe(
    'ORG_ASSET_DEPENDENTS',
  );

  // Mapping saves run under the shared organization mutation lock.
  const lockNonce = async () =>
    String(
      (
        await database
          .repository('orgMutationLock')
          .findOne({ filter: { id: 'organization' } })
      )?.nonce,
    );
  const nonceBefore = await lockNonce();
  expect((await putPermissions(position.id, [])).status).toBe(200);
  expect(await lockNonce()).not.toBe(nonceBefore);

  // Position deactivation bumps the very same lock row, so mapping writes and
  // deactivation are mutually exclusive even under concurrency.
  const nonceBeforeDeactivate = await lockNonce();
  const deactivate = await send(`positions/${position.id}/setStatus`, {
    version: position.version,
    reason: 'Guard cleared',
    status: 'inactive',
  });
  expect(deactivate.status).toBe(200);
  expect(await lockNonce()).not.toBe(nonceBeforeDeactivate);
});

test('shared lock helper always targets the single organization mutation row', async () => {
  expect(ORG_MUTATION_LOCK_ID).toBe('organization');
  const calls: Array<{ repository: string; args: unknown }> = [];
  const connection = {
    repository: (name: string) => ({
      updateOne: async (args: unknown) => {
        calls.push({ repository: name, args });
        return {};
      },
    }),
  };
  await lockOrgMutation(connection as unknown as DatabaseConnection);
  expect(calls).toEqual([
    {
      repository: 'orgMutationLock',
      args: {
        filter: { id: 'organization' },
        values: { nonce: expect.any(String) },
      },
    },
  ]);
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

// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
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

test('saves template and direct grants atomically and revokes keys that leave the position', async ({
  testApp,
  database,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const send = async (
    path: string,
    body: unknown,
    method = 'POST',
  ): Promise<{ status: number; data: Record<string, unknown> }> => {
    const response = await admin.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      data: ((await response.json()) as { data: Record<string, unknown> }).data,
    };
  };

  const sector = await send('/organization/sectors', {
    name: 'Permission energy',
    code: `PERM-${randomUUID().slice(0, 6)}`,
  });
  const group = await send('/organization/subjects', {
    name: 'Permission group',
    code: `PERM-G-${randomUUID().slice(0, 6)}`,
    type: 'group',
  });
  const company = await send('/organization/subjects', {
    name: 'Permission company',
    code: `PERM-C-${randomUUID().slice(0, 6)}`,
    type: 'company',
    parentId: group.data.id,
    sectorId: sector.data.id,
    regionId: '00000000-0000-4000-8000-000000000001',
  });
  const unit = await send('/organization/units', {
    name: 'Permission unit',
    code: `PERM-U-${randomUUID().slice(0, 6)}`,
    type: 'department',
    subjectId: company.data.id,
  });
  const position = await send('/organization/positions', {
    name: 'Permission position',
    code: `PERM-P-${randomUUID().slice(0, 6)}`,
    unitId: unit.data.id,
  });
  const positionId = String(position.data.id);

  const template = await send('/position-permissions/templates', {
    code: `PERM-TPL-${randomUUID().slice(0, 6)}`,
    name: 'Permission template',
    permissionSetKeys: ['organization-reader'],
  });
  expect(template.status).toBe(200);
  const templateId = String(template.data.id);

  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const user = await users.create({
    name: 'Permission holder',
    email: `perm-${randomUUID()}@example.test`,
    password: randomUUID(),
  });
  const now = new Date().toISOString();
  const personId = randomUUID();
  await database.repository('personnelEmployees').createOne({
    values: {
      id: personId,
      code: `PERM-E-${randomUUID().slice(0, 6)}`,
      name: 'Permission holder',
      status: 'active',
      lifecycleVersion: 0,
      createdBy: 'test',
      accountId: user.id,
      subjectId: company.data.id,
      data: { accountId: user.id },
      createdAt: now,
      updatedAt: now,
    },
  });
  await database.repository('personnelAssignments').createOne({
    values: {
      id: randomUUID(),
      code: `PERM-A-${randomUUID().slice(0, 6)}`,
      name: 'Permission holder',
      status: 'active',
      lifecycleVersion: 0,
      createdBy: 'test',
      data: { type: 'primary', startDate: '2020-01-01', endDate: null },
      createdAt: now,
      updatedAt: now,
      subjectId: company.data.id,
      personId,
      positionId,
    },
  });

  const grants = async () => {
    const rows = await database
      .repository('authorizationPermissionSetAssignments')
      .findMany({ filter: { subjectType: 'user', subjectId: user.id } });
    return rows.map((row) => String(row.permissionSetKey));
  };

  // One request links the template and replaces the explicit mappings.
  const linked = await send(
    `/position-permissions/${positionId}`,
    { permissionSetKeys: [], templateId },
    'PUT',
  );
  expect(linked.status).toBe(200);
  expect(linked.data).toMatchObject({
    templateId,
    members: 1,
    granted: 1,
  });
  expect(await grants()).toContain('organization-reader');

  // A template edited while linked moves the holder from the old key to the
  // new one instead of leaving the removed key behind.
  const updatedTemplate = await send(
    `/position-permissions/templates/${templateId}`,
    { permissionSetKeys: ['materials-reader'] },
    'PUT',
  );
  expect(updatedTemplate.status).toBe(200);
  const afterTemplateUpdate = await grants();
  expect(afterTemplateUpdate).toContain('materials-reader');
  expect(afterTemplateUpdate).not.toContain('organization-reader');

  // Unlinking the template removes the inherited key again; the old code only
  // looked at keys still configured on some position and leaked this grant.
  const unlinked = await send(
    `/position-permissions/${positionId}`,
    { permissionSetKeys: [], templateId: null },
    'PUT',
  );
  expect(unlinked.status).toBe(200);
  expect(await grants()).not.toContain('materials-reader');

  // The older dedicated link endpoint stays supported for existing callers.
  const relinked = await send(
    `/position-permissions/${positionId}/template`,
    { templateId },
    'PUT',
  );
  expect(relinked.status).toBe(200);
  expect(await grants()).toContain('materials-reader');
  const detached = await send(
    `/position-permissions/${positionId}/template`,
    { templateId: null },
    'PUT',
  );
  expect(detached.status).toBe(200);
  expect(await grants()).not.toContain('materials-reader');

  const catalogue = await admin.fetch('/position-permissions');
  expect(catalogue.status).toBe(200);
  const permissionSets = (
    (await catalogue.json()) as {
      data: {
        permissionSets: {
          key: string;
          pageCount: number;
          actionCount: number;
        }[];
      };
    }
  ).data.permissionSets;
  const reader = permissionSets.find(
    (set) => set.key === 'organization-reader',
  );
  expect(reader).toBeDefined();
  expect(reader?.pageCount).toBeGreaterThan(0);
  expect(reader?.actionCount).toBeGreaterThanOrEqual(0);
});

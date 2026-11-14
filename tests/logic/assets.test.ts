// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
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

test('registers fixed assets and tracks custodian assignment, return and disposal', async ({
  testApp,
  request,
  database,
}) => {
  expect((await request('/assets')).status).toBe(401);
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const send = async (path: string, body: unknown, method = 'POST') =>
    admin.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
  const create = async (path: string, body: unknown) => {
    const response = await send(path, body);
    expect(response.status).toBe(201);
    return (await response.json()).data;
  };
  const subject = await create('/organization/subjects', {
    code: `AST-${randomUUID().slice(0, 6)}`,
    name: 'Asset test company',
    type: 'group',
  });
  const employeeId = randomUUID();
  await database.repository('personnelEmployees').createOne({
    values: {
      id: employeeId,
      code: `AST-E-${randomUUID().slice(0, 6)}`,
      name: 'Asset custodian',
      status: 'active',
      subjectId: subject.id,
      data: {},
      revision: 1,
      lifecycleVersion: 0,
      createdBy: admin.user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const options = (await (await admin.fetch('/assets/options')).json()).data;
  expect(
    options.employees.find((employee: { id: string }) => employee.id === employeeId),
  ).toMatchObject({
    code: expect.any(String),
    name: 'Asset custodian',
    subjectId: subject.id,
  });
  expect(options.permissions.manage).toBe(true);
  expect(options.categories).toEqual([
    'electronics',
    'furniture',
    'vehicle',
    'machinery',
    'instrument',
    'other',
  ]);

  const asset = await create('/assets', {
    subjectId: subject.id,
    name: 'Laptop',
    category: 'electronics',
    originalCost: '12000.00',
    location: 'Head office',
  });
  expect(asset.code).toMatch(/^AST-\d{8}-[A-F0-9]{6}$/);
  expect(asset.status).toBe('in_stock');
  expect(asset.category).toBe('electronics');
  expect(asset.originalCost).toBe('12000.00');

  const listed = await admin.fetch('/assets');
  expect(listed.status).toBe(200);
  expect((await listed.json()).data).toContainEqual(
    expect.objectContaining({ id: asset.id, name: 'Laptop' }),
  );

  // P1：停用公司不可再入账
  const inactiveSubject = await create('/organization/subjects', {
    code: `AST-${randomUUID().slice(0, 6)}`,
    name: 'Inactive company',
    type: 'group',
  });
  await database.repository('orgSubjects').updateOne({
    filter: { id: inactiveSubject.id },
    values: { status: 'inactive' },
  });
  const inactiveCreate = await send('/assets', {
    subjectId: inactiveSubject.id,
    name: 'Blocked laptop',
  });
  expect(inactiveCreate.status).toBe(400);
  const inactiveError = (await inactiveCreate.json()) as {
    error: { reason: string; message: string };
  };
  expect(inactiveError.error.reason).toBe('ASSET_SUBJECT_INACTIVE');

  // P1：跨公司保管人分配被拒
  const otherSubject = await create('/organization/subjects', {
    code: `AST-${randomUUID().slice(0, 6)}`,
    name: 'Other company',
    type: 'group',
  });
  const otherEmployeeId = randomUUID();
  await database.repository('personnelEmployees').createOne({
    values: {
      id: otherEmployeeId,
      code: `AST-O-${randomUUID().slice(0, 6)}`,
      name: 'Other company custodian',
      status: 'active',
      subjectId: otherSubject.id,
      data: {},
      revision: 1,
      lifecycleVersion: 0,
      createdBy: admin.user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const crossCompany = await send(`/assets/${asset.id}/assign`, {
    version: asset.version,
    employeeId: otherEmployeeId,
  });
  expect(crossCompany.status).toBe(400);
  const crossError = (await crossCompany.json()) as {
    error: { reason: string; message: string };
  };
  expect(crossError.error.reason).toBe('ASSET_CUSTODIAN_COMPANY');

  const assigned = (
    await (
      await send(`/assets/${asset.id}/assign`, {
        version: asset.version,
        employeeId,
        location: 'Desk 3',
      })
    ).json()
  ).data;
  expect(assigned).toMatchObject({
    status: 'assigned',
    custodianEmployeeId: employeeId,
    location: 'Desk 3',
  });
  expect(assigned.events[0]).toMatchObject({
    action: 'assign',
    toEmployeeId: employeeId,
    fromStatus: 'in_stock',
    toStatus: 'assigned',
  });

  const returned = (
    await (
      await send(`/assets/${asset.id}/return`, {
        version: assigned.version,
        location: 'IT store',
      })
    ).json()
  ).data;
  expect(returned).toMatchObject({
    status: 'in_stock',
    custodianEmployeeId: null,
  });
  expect(returned.events[0]).toMatchObject({
    action: 'return',
    fromStatus: 'assigned',
    toStatus: 'in_stock',
  });

  // P1：PATCH 编辑留痕，事件携带 fromStatus/toStatus
  const edited = (
    await (
      await send(
        `/assets/${asset.id}`,
        {
          version: returned.version,
          name: 'Laptop Pro',
          location: 'Desk 4',
        },
        'PATCH',
      )
    ).json()
  ).data;
  expect(edited).toMatchObject({
    name: 'Laptop Pro',
    location: 'Desk 4',
  });
  expect(edited.events[0]).toMatchObject({
    action: 'update',
    fromStatus: 'in_stock',
    toStatus: 'in_stock',
    fromLocation: 'IT store',
    toLocation: 'Desk 4',
  });

  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const authz = testApp.application.container.resolve(authorizationToken);
  const makeUser = async (name: string, actions: string[]) => {
    const email = `${randomUUID()}@example.test`;
    const password = randomUUID();
    const account = await users.create({ name, email, password });
    const role = await authz.permissionSets.create({
      key: `asset-${randomUUID()}`,
      title: name,
      grants: [
        {
          resource: { type: 'settings', id: 'assets' },
          actions: actions.map((action) => ({ action })),
        },
      ],
    });
    await authz.permissionSets.assign({
      permissionSet: role.key,
      subject: { type: 'user', id: account.id },
    });
    return {
      id: account.id,
      client: await signIn(testApp, { email, password }),
    };
  };
  const sendAs = async (
    client: Awaited<ReturnType<typeof signIn>>,
    path: string,
    body: unknown,
  ) =>
    client.fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });

  // P0 修复：种子出厂即带审批授权——asset-system-admin 含 approve，且存在专职 asset-approver
  const permissionSets = database.repository('authorizationPermissionSets');
  const systemAdminSet = await permissionSets.findOne({
    filter: { key: 'asset-system-admin' },
  });
  const settingsActions = (
    systemAdminSet?.grants as
      | { resource?: { type?: string; id?: string }; actions?: { action?: string }[] }[]
      | undefined
  )?.find(
    (grant) =>
      grant.resource?.type === 'settings' && grant.resource?.id === 'assets',
  )?.actions;
  expect(settingsActions?.some((action) => action.action === 'approve')).toBe(
    true,
  );
  const approverSet = await permissionSets.findOne({
    filter: { key: 'asset-approver' },
  });
  expect(
    (approverSet?.grants as { actions?: { action?: string }[] }[]).some(
      (grant) =>
        grant.actions?.some((action) => action.action === 'approve'),
    ),
  ).toBe(true);

  const supervisor = await makeUser('Asset supervisor', [
    'read',
    'manage',
    'approve',
    'readAll',
  ]);
  const approver = await makeUser('Asset approver', [
    'read',
    'approve',
    'readAll',
  ]);

  const pendingScrap = (
    await (
      await sendAs(
        supervisor.client,
        `/assets/${asset.id}/scrap/request`,
        {
          version: edited.version,
          reason: 'Board failure',
        },
      )
    ).json()
  ).data;
  expect(pendingScrap).toMatchObject({
    status: 'in_stock',
    scrapPending: true,
    scrapReason: 'Board failure',
  });

  // 报废申请不可自批
  const selfDecision = await sendAs(
    supervisor.client,
    `/assets/${asset.id}/scrap/decision`,
    {
      version: pendingScrap.version,
      approve: true,
      note: 'Board failure',
    },
  );
  expect(selfDecision.status).toBe(409);
  const selfError = (await selfDecision.json()) as {
    error: { reason: string; message: string };
  };
  expect(selfError.error.reason).toBe('ASSET_CONFLICT');
  expect(selfError.error.message).toBe('ASSET_SELF_APPROVAL');

  const scrapped = (
    await (
      await sendAs(approver.client, `/assets/${asset.id}/scrap/decision`, {
        version: pendingScrap.version,
        approve: true,
        note: 'Board failure',
      })
    ).json()
  ).data;
  expect(scrapped.status).toBe('scrapped');
  expect(scrapped.events[0]).toMatchObject({
    action: 'scrap',
    note: 'Board failure',
    fromStatus: 'in_stock',
    toStatus: 'scrapped',
  });

  const stale = await send(`/assets/${asset.id}/assign`, {
    version: returned.version,
    employeeId,
  });
  expect(stale.status).toBe(400);
});

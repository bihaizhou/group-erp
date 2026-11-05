// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
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
  expect(options.employees).toContainEqual({
    id: employeeId,
    code: expect.any(String),
    name: 'Asset custodian',
  });
  expect(options.permissions.manage).toBe(true);

  const asset = await create('/assets', {
    subjectId: subject.id,
    name: 'Laptop',
    category: '电子设备',
    originalCost: '12000.00',
    location: 'Head office',
  });
  expect(asset.code).toMatch(/^AST-\d{8}-[A-F0-9]{6}$/);
  expect(asset.status).toBe('in_stock');
  expect(asset.originalCost).toBe('12000.00');

  const listed = await admin.fetch('/assets');
  expect(listed.status).toBe(200);
  expect((await listed.json()).data).toContainEqual(
    expect.objectContaining({ id: asset.id, name: 'Laptop' }),
  );

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

  const pendingScrap = (
    await (
      await send(`/assets/${asset.id}/scrap/request`, {
        version: returned.version,
        reason: 'Board failure',
      })
    ).json()
  ).data;
  expect(pendingScrap).toMatchObject({
    status: 'in_stock',
    scrapPending: true,
    scrapReason: 'Board failure',
  });

  const scrapped = (
    await (
      await send(`/assets/${asset.id}/scrap/decision`, {
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
  });

  const stale = await send(`/assets/${asset.id}/assign`, {
    version: returned.version,
    employeeId,
  });
  expect(stale.status).toBe(400);
});

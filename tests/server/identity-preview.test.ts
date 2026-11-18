// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
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
    auth: { secret: 'test-auth-secret-at-least-32-characters' },
  },
});

const json = (body: unknown, method = 'POST') => ({
  method,
  headers: {
    'content-type': 'application/json',
    origin: 'http://localhost',
    'Idempotency-Key': `${Date.now()}.${randomUUID()}`,
  },
  body: JSON.stringify(body),
});

interface ReportContext {
  data: {
    identity: {
      employee: { id: string } | null;
      superAdmin: boolean;
      reason: string | null;
    };
  };
}

test('a root account previews an employee identity instead of creating a fake card', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const sector = await admin.fetch(
    '/organization/sectors',
    json({ code: 'PREVIEW-SECTOR', name: '预览板块' }),
  );
  expect(sector.status).toBe(201);
  const sectorId = ((await sector.json()) as { data: { id: string } }).data.id;
  const region = await admin.fetch(
    '/organization/regions',
    json({ code: 'PREVIEW-REGION', name: '预览地区' }),
  );
  expect(region.status).toBe(201);
  const regionId = ((await region.json()) as { data: { id: string } }).data.id;
  const subject = await admin.fetch(
    '/organization/subjects',
    json({
      code: 'PREVIEW-ORG',
      name: '预览公司',
      type: 'company',
      sectorId,
      regionId,
    }),
  );
  expect(subject.status).toBe(201);
  const subjectId = ((await subject.json()) as { data: { id: string } }).data
    .id;
  const created = await admin.fetch(
    '/people/employees',
    json({ code: 'PREVIEW-01', name: '预览员工', subjectId, data: {} }),
  );
  expect(created.status).toBe(201);
  const employeeId = ((await created.json()) as { data: { id: string } }).data
    .id;

  const before = (await (
    await admin.fetch('/production/report-context')
  ).json()) as ReportContext;
  expect(before.data.identity.employee).toBeNull();
  expect(before.data.identity.superAdmin).toBe(true);

  const listed = await admin.fetch('/identity-preview/employees');
  expect(listed.status).toBe(200);
  const listedBody = (await listed.json()) as {
    data: { employees: { id: string; name: string }[] };
  };
  expect(
    listedBody.data.employees.some(
      (employee) => employee.id === employeeId && employee.name === '预览员工',
    ),
  ).toBe(true);

  const started = await admin.fetch('/identity-preview', json({ employeeId }));
  if (started.status !== 200)
    console.log('START', started.status, await started.text());
  expect(started.status).toBe(200);
  const startedBody = (await started.json()) as {
    data: { active: boolean; employeeId: string; employeeName: string };
  };
  expect(startedBody.data).toMatchObject({
    active: true,
    employeeId,
    employeeName: '预览员工',
  });

  const current = (await (
    await admin.fetch('/identity-preview/current')
  ).json()) as {
    data: { active: boolean; employeeId: string };
  };
  expect(current.data).toMatchObject({ active: true, employeeId });

  // The business identity resolvers follow the preview: production now sees
  // the employee instead of falling back to the super-admin bypass.
  const after = (await (
    await admin.fetch('/production/report-context')
  ).json()) as ReportContext;
  expect(after.data.identity.employee?.id).toBe(employeeId);
  expect(after.data.identity.superAdmin).toBe(false);

  const stopped = await admin.fetch('/identity-preview', {
    method: 'DELETE',
    headers: {
      origin: 'http://localhost',
      'Idempotency-Key': `${Date.now()}.${randomUUID()}`,
    },
  });
  expect(stopped.status).toBe(200);
  const ended = (await (
    await admin.fetch('/identity-preview/current')
  ).json()) as {
    data: { active: boolean };
  };
  expect(ended.data.active).toBe(false);

  const restored = (await (
    await admin.fetch('/production/report-context')
  ).json()) as ReportContext;
  expect(restored.data.identity.employee).toBeNull();
  expect(restored.data.identity.superAdmin).toBe(true);
});

test('only the root account may start a preview', async ({ testApp }) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const created = await admin.fetch(
    '/users',
    json({
      name: 'previewer',
      username: 'previewer',
      email: 'previewer@example.test',
      password: 'Preview-123456!',
      roleScopes: { app: [] },
    }),
  );
  expect(created.status).toBe(201);
  const session = await signIn(testApp, {
    username: 'previewer',
    password: 'Preview-123456!',
  });
  const denied = await session.fetch(
    '/identity-preview',
    json({ employeeId: '00000000-0000-4000-8000-000000000000' }),
  );
  expect(denied.status).toBe(403);
  const current = await session.fetch('/identity-preview/current');
  expect(current.status).toBe(200);
  expect(
    ((await current.json()) as { data: { active: boolean } }).data.active,
  ).toBe(false);
});

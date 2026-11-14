// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { createStandaloneServer } from '../../server/standalone.js';
import { fixture as purchaseFixture } from '../helpers/purchase-requests.js';

const createOperationKey = () => `${Date.now()}.${randomUUID()}`;
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
const json = (body: unknown, method = 'PUT') => ({
  method,
  headers: {
    'content-type': 'application/json',
    origin: 'http://localhost',
    'Idempotency-Key': createOperationKey(),
  },
  body: JSON.stringify(body),
});

test('field policy catalog requires the permission-sets read grant', async ({
  testApp,
  app,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  expect((await admin.fetch('/field-policies/catalog')).status).toBe(200);

  const sets = app.container.resolve(authorizationToken).permissionSets;
  const key = `fp-catalog-${randomUUID().slice(0, 8)}`;
  await sets.create({
    key,
    grants: [
      {
        resource: { type: 'settings', id: 'assets' },
        actions: [{ action: 'read' }],
      },
    ],
  });
  const username = `fpcat${randomUUID().slice(0, 8)}`;
  const created = await admin.fetch(
    '/users',
    json(
      {
        name: username,
        username,
        email: `${username}@example.test`,
        password: 'Field-policy-123!',
        roleScopes: { app: [key] },
      },
      'POST',
    ),
  );
  expect(created.status).toBe(201);

  const session = await signIn(testApp, {
    username,
    password: 'Field-policy-123!',
  });
  expect((await session.fetch('/field-policies/catalog')).status).toBe(403);
  expect(
    (await session.fetch('/field-policies?permissionSetKey=anything')).status,
  ).toBe(403);
});

test('field policy saves replay under one request key and reject key reuse', async ({
  testApp,
  app,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const sets = app.container.resolve(authorizationToken).permissionSets;
  const key = `fp-save-${randomUUID().slice(0, 8)}`;
  await sets.create({ key, grants: [] });

  const requestKey = randomUUID();
  const policies = [
    { resource: 'people.assets', field: 'originalCost', access: 'hidden' },
    { resource: 'people.assets', field: 'notes', access: 'visible' },
  ];
  const payload = { permissionSetKey: key, requestKey, policies };

  const first = await admin.fetch('/field-policies', json(payload));
  expect(first.status).toBe(200);
  const firstBody = await first.json();
  expect(firstBody.data.policies).toEqual(policies);

  const byField = (rows: { field: string }[]) =>
    [...rows].sort((a, b) => a.field.localeCompare(b.field));
  const replay = await admin.fetch('/field-policies', json(payload));
  expect(replay.status).toBe(200);
  expect(byField((await replay.json()).data.policies)).toEqual(byField(policies));

  const conflict = await admin.fetch(
    '/field-policies',
    json({
      ...payload,
      policies: [{ resource: 'people.assets', field: 'notes', access: 'write' }],
    }),
  );
  expect(conflict.status).toBe(409);
  expect(await conflict.text()).toContain('FIELD_POLICY_REQUEST_KEY_REUSED');
});

test('assets enforce field policies on reads and rejects hidden-field writes', async ({
  testApp,
  app,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const sets = app.container.resolve(authorizationToken).permissionSets;
  const key = `fp-assets-${randomUUID().slice(0, 8)}`;
  await sets.create({
    key,
    grants: [
      {
        resource: { type: 'settings', id: 'assets' },
        actions: [
          { action: 'read' },
          { action: 'manage' },
          { action: 'readAll' },
        ],
      },
    ],
  });

  const subjectCreated = await admin.fetch(
    '/organization/subjects',
    json(
      {
        code: `FP-S-${randomUUID().slice(0, 6)}`,
        name: 'Field policy company',
        type: 'group',
      },
      'POST',
    ),
  );
  expect(subjectCreated.status).toBe(201);
  const subject = (await subjectCreated.json()).data;

  const assetCreated = await admin.fetch(
    '/assets',
    json(
      {
        subjectId: subject.id,
        code: `FP-A-${randomUUID().slice(0, 6)}`,
        name: 'Test laptop',
        category: 'electronics',
        originalCost: '100.50',
        notes: 'tracked',
      },
      'POST',
    ),
  );
  expect(assetCreated.status).toBe(201);
  const asset = (await assetCreated.json()).data;

  const catalogFields = [
    'code',
    'name',
    'category',
    'custodianEmployeeId',
    'location',
    'acquiredOn',
    'originalCost',
    'currency',
    'notes',
  ];
  const saved = await admin.fetch(
    '/field-policies',
    json({
      permissionSetKey: key,
      requestKey: randomUUID(),
      policies: catalogFields.map((field) => ({
        resource: 'people.assets',
        field,
        access: field === 'originalCost' ? 'hidden' : 'write',
      })),
    }),
  );
  expect(saved.status).toBe(200);

  const username = `fpassets${randomUUID().slice(0, 8)}`;
  const created = await admin.fetch(
    '/users',
    json(
      {
        name: username,
        username,
        email: `${username}@example.test`,
        password: 'Field-policy-123!',
        roleScopes: { app: [key] },
      },
      'POST',
    ),
  );
  expect(created.status).toBe(201);

  const session = await signIn(testApp, {
    username,
    password: 'Field-policy-123!',
  });

  const list = await session.fetch('/assets');
  expect(list.status).toBe(200);
  const listBody = await list.json();
  expect(listBody.data).toHaveLength(1);
  expect(listBody.data[0]).toHaveProperty('notes', 'tracked');
  expect(listBody.data[0]).not.toHaveProperty('originalCost');

  const detail = await session.fetch(`/assets/${asset.id}`);
  expect(detail.status).toBe(200);
  const detailBody = await detail.json();
  expect(detailBody.data).toHaveProperty('notes', 'tracked');
  expect(detailBody.data).not.toHaveProperty('originalCost');

  const rejected = await session.fetch(
    `/assets/${asset.id}`,
    json({ version: 1, name: 'Renamed', originalCost: '999.00' }, 'PATCH'),
  );
  expect(rejected.status).toBe(403);
  expect(await rejected.text()).toContain('FIELD_NOT_WRITABLE');

  const allowed = await session.fetch(
    `/assets/${asset.id}`,
    json({ version: 1, name: 'Renamed' }, 'PATCH'),
  );
  expect(allowed.status).toBe(200);
  expect((await allowed.json()).data).toMatchObject({ name: 'Renamed' });
});

test('purchase requests redact hidden head and line fields and reject hidden writes', async ({
  testApp,
  database,
}) => {
  const f = await purchaseFixture(testApp, database);
  const key = `fp-proc-${randomUUID().slice(0, 8)}`;
  await f.authz.permissionSets.create({ key, grants: [] });
  await f.authz.permissionSets.assign({
    permissionSet: key,
    subject: { type: 'user', id: f.applicant.user.id },
  });

  const policies = [
    ...['code', 'usage', 'neededOn', 'notes', 'status'].map((field) => ({
      resource: 'purchase.request',
      field,
      access: field === 'notes'
        ? 'hidden'
        : field === 'usage' || field === 'neededOn'
          ? 'write'
          : 'visible',
    })),
    ...[
      'lineNo',
      'originalName',
      'originalSpecification',
      'requestedQuantity',
      'requestedUnitText',
      'baseQuantity',
      'usage',
      'notes',
    ].map((field) => ({
      resource: 'purchase.request.line',
      field,
      access:
        field === 'notes'
          ? 'hidden'
          : field === 'lineNo' || field === 'baseQuantity'
            ? 'visible'
            : 'write',
    })),
  ];
  const saved = await f.admin.fetch(
    '/field-policies',
    json({ permissionSetKey: key, requestKey: randomUUID(), policies }),
  );
  expect(saved.status).toBe(200);

  // Drafting with empty notes still works for a restricted writer.
  const draft = await f.draft();
  expect(draft.notes ?? '').toBe('');

  const list = await f.applicant.session.fetch('/procurement/requests');
  expect(list.status).toBe(200);
  const listBody = await list.json();
  const row = listBody.data.find(
    (candidate: { id: string }) => candidate.id === draft.id,
  );
  expect(row).toBeTruthy();
  expect(row).not.toHaveProperty('notes');

  const detail = await f.applicant.session.fetch(
    `/procurement/requests/${draft.id}`,
  );
  expect(detail.status).toBe(200);
  const detailBody = await detail.json();
  expect(detailBody.data).not.toHaveProperty('notes');
  expect(detailBody.data.lines[0]).not.toHaveProperty('notes');

  // Providing a hidden field on create is rejected before any write.
  const rejected = await f.applicant.session.fetch('/procurement/requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({
      content: { ...f.content(), notes: 'Secret' },
      requestKey: randomUUID(),
    }),
  });
  expect(rejected.status).toBe(403);
  expect(await rejected.text()).toContain('FIELD_NOT_WRITABLE');
});

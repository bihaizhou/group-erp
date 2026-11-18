// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import { createStandaloneServer } from '../../server/standalone.js';
import {
  fixture as purchaseFixture,
  send,
} from '../helpers/purchase-requests.js';
import { pageFieldPoliciesFor } from '../../server/providers/page-field-visibility.js';

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

test('page rows store three states and re-derive resource policies', async ({
  testApp,
  database,
}) => {
  const f = await purchaseFixture(testApp, database);
  const key = `pfp-${randomUUID().slice(0, 8)}`;
  await f.authz.permissionSets.create({ key, grants: [] });
  await f.authz.permissionSets.assign({
    permissionSet: key,
    subject: { type: 'user', id: f.reviewer.user.id },
  });

  const saved = await send(
    f.admin,
    '/page-field-visibility',
    {
      permissionSetKey: key,
      pageKey: 'procurement-requests',
      mode: 'override',
      fields: [
        { resource: 'purchase.request', field: 'code', visible: true, writable: false },
        { resource: 'purchase.request', field: 'usage', visible: true, writable: true },
        { resource: 'purchase.request', field: 'notes', visible: false, writable: false },
      ],
    },
    'PUT',
  );
  expect(saved.status).toBe(200);
  const config = (await saved.json()).data;
  expect(config.mode).toBe('independent');
  expect(config.configured).toBe(true);
  expect(config.fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        resource: 'purchase.request',
        field: 'code',
        visible: true,
        writable: false,
      }),
      expect.objectContaining({
        resource: 'purchase.request',
        field: 'usage',
        visible: true,
        writable: true,
      }),
      expect.objectContaining({
        resource: 'purchase.request',
        field: 'notes',
        visible: false,
      }),
    ]),
  );

  // The configured-pages listing reports the page for green dots.
  const pages = await f.admin.fetch(
    `/page-field-visibility/pages?permissionSetKey=${key}`,
  );
  expect(pages.status).toBe(200);
  expect((await pages.json()).data.pages).toEqual([
    { pageKey: 'procurement-requests', configured: true },
  ]);

  // Saving page rows re-derived the resource-level policies: readonly stays
  // visible, writable becomes write, hidden gets no row. The set had no
  // explicit policies, so it keeps the legacy default: pages without rows
  // stay fully available instead of silently turning hidden.
  const policies = await f.admin.fetch(`/field-policies?permissionSetKey=${key}`);
  expect(policies.status).toBe(200);
  const policyBody = await policies.json();
  expect(policyBody.data.legacyDefault).toBe(true);
  expect(policyBody.data.policies).toEqual(
    expect.arrayContaining([
      { resource: 'purchase.request', field: 'code', access: 'visible' },
      { resource: 'purchase.request', field: 'usage', access: 'write' },
    ]),
  );
  expect(policyBody.data.policies).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        resource: 'purchase.request',
        field: 'notes',
      }),
    ]),
  );

  // Per-page policies overlay the account's resource policies.
  const perPage = await pageFieldPoliciesFor(
    database,
    { type: 'user', id: f.reviewer.user.id },
    'procurement-requests',
  );
  const accessOf = (field: string) =>
    perPage.find(
      (policy) =>
        policy.resource === 'purchase.request' && policy.field === field,
    )?.access;
  expect(accessOf('code')).toBe('visible');
  expect(accessOf('usage')).toBe('write');
  expect(accessOf('notes')).toBe('hidden');

  // The effective endpoint now reports writable fields for the client forms.
  const effective = await f.reviewer.session.fetch(
    `/page-field-visibility/effective?pageKey=procurement-requests`,
  );
  expect(effective.status).toBe(200);
  const effectiveBody = await effective.json();
  expect(effectiveBody.data.configured).toBe(true);
  expect(effectiveBody.data.visible).toContain('purchase.request.code');
  expect(effectiveBody.data.writable).toEqual(['purchase.request.usage']);
});

test('saving page rows keeps the ladder model of an already-ladder set', async ({
  testApp,
  database,
}) => {
  const f = await purchaseFixture(testApp, database);
  const key = `pfp-${randomUUID().slice(0, 8)}`;
  await f.authz.permissionSets.create({ key, grants: [] });
  await f.authz.permissionSets.assign({
    permissionSet: key,
    subject: { type: 'user', id: f.reviewer.user.id },
  });
  // An explicit resource-level save puts the set on the ladder model.
  const switched = await send(
    f.admin,
    '/field-policies',
    { permissionSetKey: key, policies: [], requestKey: `switch-${key}` },
    'PUT',
  );
  expect(switched.status).toBe(200);
  const before = await f.admin.fetch(`/field-policies?permissionSetKey=${key}`);
  expect((await before.json()).data.legacyDefault).toBe(false);

  const saved = await send(
    f.admin,
    '/page-field-visibility',
    {
      permissionSetKey: key,
      pageKey: 'procurement-requests',
      mode: 'override',
      fields: [
        {
          resource: 'purchase.request',
          field: 'code',
          visible: true,
          writable: false,
        },
      ],
    },
    'PUT',
  );
  expect(saved.status).toBe(200);

  const after = await f.admin.fetch(`/field-policies?permissionSetKey=${key}`);
  const body = await after.json();
  // Saving a page must not silently switch the set back to the legacy model.
  expect(body.data.legacyDefault).toBe(false);
  expect(body.data.policies).toEqual(
    expect.arrayContaining([
      { resource: 'purchase.request', field: 'code', access: 'visible' },
    ]),
  );
  const perPage = await pageFieldPoliciesFor(
    database,
    { type: 'user', id: f.reviewer.user.id },
    'procurement-requests-detail',
  );
  const accessOf = (field: string) =>
    perPage.find(
      (policy) =>
        policy.resource === 'purchase.request' && policy.field === field,
    )?.access;
  expect(accessOf('code')).toBe('visible');
  // Fields absent from the ladder grants stay hidden on unconfigured pages.
  expect(accessOf('notes')).toBe('hidden');
});

test('an unconfigured page keeps the resource-level policies', async ({
  testApp,
  database,
}) => {
  const f = await purchaseFixture(testApp, database);
  const perPage = await pageFieldPoliciesFor(
    database,
    { type: 'user', id: f.reviewer.user.id },
    'procurement-requests-detail',
  );
  // Reviewer holds no appFieldPolicies rows of its own, so the base is empty.
  expect(perPage).toEqual([]);
});

test('an unconfigured detail page starts from the create page settings', async ({
  testApp,
  database,
}) => {
  const f = await purchaseFixture(testApp, database);
  const key = `pfp-${randomUUID().slice(0, 8)}`;
  await f.authz.permissionSets.create({ key, grants: [] });
  await f.authz.permissionSets.assign({
    permissionSet: key,
    subject: { type: 'user', id: f.reviewer.user.id },
  });
  const saved = await send(
    f.admin,
    '/page-field-visibility',
    {
      permissionSetKey: key,
      pageKey: 'procurement-requests-new',
      mode: 'override',
      fields: [
        {
          resource: 'purchase.request',
          field: 'code',
          visible: true,
          writable: true,
        },
        {
          resource: 'purchase.request',
          field: 'notes',
          visible: false,
          writable: false,
        },
      ],
    },
    'PUT',
  );
  expect(saved.status).toBe(200);
  // The detail page has no rows of its own; per the plan it copies the
  // create page's settings as its initial values, enforced server-side.
  const perPage = await pageFieldPoliciesFor(
    database,
    { type: 'user', id: f.reviewer.user.id },
    'procurement-requests-detail',
  );
  const accessOf = (field: string) =>
    perPage.find(
      (policy) =>
        policy.resource === 'purchase.request' && policy.field === field,
    )?.access;
  expect(accessOf('code')).toBe('write');
  expect(accessOf('notes')).toBe('hidden');
});

test('merges the list and detail edit entries into one page', async ({
  testApp,
  database,
}) => {
  const f = await purchaseFixture(testApp, database);
  const key = `pfp-${randomUUID().slice(0, 8)}`;
  await f.authz.permissionSets.create({ key, grants: [] });
  await f.authz.permissionSets.assign({
    permissionSet: key,
    subject: { type: 'user', id: f.reviewer.user.id },
  });
  const save = (pageKey: string, fields: unknown[]) =>
    send(
      f.admin,
      '/page-field-visibility',
      { permissionSetKey: key, pageKey, mode: 'override', fields },
      'PUT',
    );
  expect(
    (
      await save('procurement-requests-list-edit', [
        {
          resource: 'purchase.request',
          field: 'code',
          visible: true,
          writable: false,
        },
        {
          resource: 'purchase.request',
          field: 'usage',
          visible: true,
          writable: true,
        },
      ])
    ).status,
  ).toBe(200);
  expect(
    (
      await save('procurement-requests-detail-edit', [
        {
          resource: 'purchase.request',
          field: 'code',
          visible: true,
          writable: false,
        },
        {
          resource: 'purchase.request',
          field: 'usage',
          visible: true,
          writable: false,
        },
        {
          resource: 'purchase.request',
          field: 'notes',
          visible: false,
          writable: false,
        },
      ])
    ).status,
  ).toBe(200);

  const canonical = await send(
    f.admin,
    `/page-field-visibility?permissionSetKey=${key}&pageKey=procurement-requests-edit`,
    undefined,
    'GET',
  );
  expect(canonical.status).toBe(200);
  const config = (await canonical.json()).data;
  expect(config.configured).toBe(true);
  expect(config.fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: 'code', visible: true, writable: false }),
      expect.objectContaining({ field: 'usage', visible: true, writable: false }),
      expect.objectContaining({ field: 'notes', visible: false, writable: false }),
    ]),
  );

  const perPage = await pageFieldPoliciesFor(
    database,
    { type: 'user', id: f.reviewer.user.id },
    'procurement-requests-edit',
  );
  const accessOf = (field: string) =>
    perPage.find(
      (policy) =>
        policy.resource === 'purchase.request' && policy.field === field,
    )?.access;
  expect(accessOf('code')).toBe('visible');
  expect(accessOf('usage')).toBe('visible');
  expect(accessOf('notes')).toBe('hidden');

  const pages = await send(
    f.admin,
    `/page-field-visibility/pages?permissionSetKey=${key}`,
    undefined,
    'GET',
  );
  expect((await pages.json()).data.pages).toEqual([
    { pageKey: 'procurement-requests-edit', configured: true },
  ]);
});

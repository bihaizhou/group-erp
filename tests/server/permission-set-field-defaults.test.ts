// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
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
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    jobs: { default: 'memory' },
    queue: { default: 'memory' },
    logging: { console: { enabled: false }, file: { enabled: false } },
  },
});

test('a new permission set starts on the deny-by-default field model', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const created = await admin.fetch('/authorization/permissionSets', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
      'idempotency-key': `${Date.now()}.${randomUUID()}`,
    },
    body: JSON.stringify({
      key: 'field-default-probe',
      title: 'Field default probe',
      grants: [
        {
          resource: { type: 'page', id: 'organization-overview' },
          actions: [{ action: 'access' }],
        },
      ],
    }),
  });
  expect(created.status).toBe(201);

  const policies = await admin.fetch(
    '/field-policies?permissionSetKey=field-default-probe',
  );
  expect(policies.status).toBe(200);
  const body = (await policies.json()) as {
    data: { policies: unknown[]; legacyDefault: boolean };
  };
  expect(body.data.policies).toEqual([]);
  expect(body.data.legacyDefault).toBe(false);

  // A seeded role that predates the ladder model keeps the legacy default, so
  // its existing access does not change under it.
  const seeded = await admin.fetch(
    '/field-policies?permissionSetKey=warehouse-transfer-operator',
  );
  expect(seeded.status).toBe(200);
  expect(
    ((await seeded.json()) as { data: { legacyDefault: boolean } }).data
      .legacyDefault,
  ).toBe(true);
});

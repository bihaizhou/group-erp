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

const grant = (pageId: string) => ({
  resource: { type: 'page', id: pageId },
  actions: [{ action: 'access' }],
});

test('rejects permission sets that grant pages the client does not serve', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const send = async (body: unknown, method = 'POST', key = 'page-probe') =>
    admin.fetch(
      method === 'POST'
        ? '/authorization/permissionSets'
        : `/authorization/permissionSets/${key}`,
      {
        method,
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
          'idempotency-key': `${Date.now()}.${randomUUID()}`,
        },
        body: JSON.stringify(body),
      },
    );

  const unknownPage = await send({
    key: 'page-probe',
    title: 'Page probe',
    grants: [grant('retired-page')],
  });
  expect(unknownPage.status).toBe(400);
  expect(await unknownPage.json()).toMatchObject({
    error: {
      status: 'INVALID_ARGUMENT',
      reason: 'UNKNOWN_PAGE_PERMISSION',
      message: expect.stringContaining('retired-page'),
    },
  });
  expect(unknownPage.headers.get('x-request-id')).toBeTruthy();

  const knownPage = await send({
    key: 'page-probe',
    title: 'Page probe',
    grants: [grant('organization-overview')],
  });
  expect(knownPage.status).toBe(201);

  const updateToUnknown = await send(
    { grants: [grant('retired-page')] },
    'PATCH',
  );
  expect(updateToUnknown.status).toBe(400);

  const updateToKnown = await send(
    { grants: [grant('organization-units'), grant('people-overview')] },
    'PATCH',
  );
  expect(updateToKnown.status).toBe(200);

  const stored = await admin.fetch('/authorization/permissionSets/page-probe');
  expect(stored.status).toBe(200);
});

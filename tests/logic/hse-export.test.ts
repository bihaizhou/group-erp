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

test('exports every incident and hazard in scope and rejects unauthorised readers', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const send = async (
    client: Awaited<ReturnType<typeof signIn>>,
    path: string,
    body?: unknown,
    method = 'GET',
  ) =>
    client.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const create = async (path: string, body: unknown) => {
    const response = await send(admin, path, body, 'POST');
    const payload = await response.json();
    expect(response.status).toBe(201);
    return payload.data;
  };
  const subject = await create('/organization/subjects', {
    code: `HSE-EX-${randomUUID().slice(0, 6)}`,
    name: 'HSE export company',
    type: 'group',
  });
  const unit = await create('/organization/units', {
    code: `HSE-EX-U-${randomUUID().slice(0, 6)}`,
    name: 'HSE export line',
    type: 'department',
    subjectId: subject.id,
  });
  const today = new Date().toISOString().slice(0, 10);
  for (const suffix of ['A', 'B']) {
    await create('/hse/incidents', {
      subjectId: subject.id,
      unitId: unit.id,
      occurredAt: new Date().toISOString(),
      type: 'injury',
      severity: 'minor',
      location: `Line ${suffix}`,
      description: `Export incident ${suffix}`,
      injuryCount: 0,
      lostDays: 0,
      environmentalRelease: false,
    });
    await create('/hse/hazards', {
      subjectId: subject.id,
      unitId: unit.id,
      source: 'walkthrough',
      level: 'general',
      description: `Export hazard ${suffix}`,
      location: `Line ${suffix}`,
      discoveredAt: today,
      ownerName: 'Export owner',
      dueAt: today,
    });
  }

  const incidents = await send(
    admin,
    `/hse/incidents/export?subjectId=${subject.id}`,
  );
  expect(incidents.status).toBe(200);
  const incidentPage = await incidents.json();
  expect(incidentPage.data).toHaveLength(2);
  expect(incidentPage.meta).toEqual({ total: 2, truncated: false });
  expect(incidentPage.data[0].subjectName).toBe('HSE export company');
  expect(
    incidentPage.data.every((row: { ownerName?: string }) => row.ownerName === ''),
  ).toBe(true);

  const hazards = await send(
    admin,
    `/hse/hazards/export?subjectId=${subject.id}&status=open`,
  );
  expect(hazards.status).toBe(200);
  const hazardPage = await hazards.json();
  expect(hazardPage.data).toHaveLength(2);
  expect(hazardPage.data[0].ownerName).toBe('Export owner');
  expect(hazardPage.meta.total).toBe(2);

  // A user without the HSE read action cannot export either list.
  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  ) as {
    create: (input: {
      name: string;
      email: string;
      password: string;
    }) => Promise<{ id: string }>;
  };
  const authorization = testApp.application.container.resolve(
    authorizationToken,
  ) as {
    permissionSets: {
      create: (input: {
        key: string;
        title: string;
        grants: unknown[];
      }) => Promise<unknown>;
      assign: (input: {
        permissionSet: string;
        subject: { type: string; id: string };
      }) => Promise<unknown>;
    };
  };
  const email = `export-outsider-${randomUUID().slice(0, 8)}@example.com`;
  const password = 'ExportPass123!';
  const user = await users.create({
    name: 'Export outsider',
    email,
    password,
  });
  const setKey = `export-outsider-${randomUUID().slice(0, 8)}`;
  await authorization.permissionSets.create({
    key: setKey,
    title: 'Export outsider',
    grants: [],
  });
  await authorization.permissionSets.assign({
    permissionSet: setKey,
    subject: { type: 'user', id: user.id },
  });
  const outsider = await signIn(testApp, { email, password });
  const denied = await send(
    outsider,
    `/hse/incidents/export?subjectId=${subject.id}`,
  );
  expect(denied.status).toBe(403);
  const deniedHazards = await send(outsider, '/hse/hazards/export');
  expect(deniedHazards.status).toBe(403);
});

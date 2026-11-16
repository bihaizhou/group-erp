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

const json = (body: unknown, method = 'PUT') => ({
  method,
  headers: {
    'content-type': 'application/json',
    origin: 'http://localhost',
    'Idempotency-Key': `${Date.now()}.${randomUUID()}`,
  },
  body: JSON.stringify(body),
});

type Client = Awaited<ReturnType<typeof signIn>>;

/** Every catalog field must be listed: the first saved policy set is the ladder default. */
const incidentFields = [
  'incidentNo',
  'occurredAt',
  'type',
  'severity',
  'location',
  'description',
  'injuryCount',
  'lostDays',
  'environmentalRelease',
  'status',
  'rootCause',
  'actions',
];
const issueFields = [
  'code',
  'title',
  'description',
  'severity',
  'ownerName',
  'dueAt',
  'status',
  'resolution',
];
const targetFields = [
  'period',
  'metric',
  'targetValue',
  'actualValue',
  'achievementPct',
  'varianceValue',
];

const policiesFor = (resource: string, fields: string[], hidden: string[]) =>
  fields.map((field) => ({
    resource,
    field,
    access: hidden.includes(field) ? 'hidden' : 'write',
  }));

test('HSE incidents and operations records enforce field policies', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const authz = testApp.application.container.resolve(authorizationToken);

  const send = async (
    client: Client,
    path: string,
    body: unknown,
    method = 'POST',
  ) => client.fetch(path, json(body, method));
  const create = async <T>(path: string, body: unknown): Promise<T> => {
    const response = await send(admin, path, body);
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { data: T };
    return payload.data;
  };
  const makeUser = async (
    name: string,
    settings: { resource: string; actions: string[] }[],
  ) => {
    const email = `${randomUUID()}@example.test`;
    const password = randomUUID();
    const account = await users.create({ name, email, password });
    const role = await authz.permissionSets.create({
      key: `fp-${randomUUID()}`,
      title: name,
      grants: settings.map(({ resource, actions }) => ({
        resource: { type: 'settings' as const, id: resource },
        actions: actions.map((action) => ({ action })),
      })),
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
  const savePolicies = async (
    userId: string,
    policies: { resource: string; field: string; access: string }[],
  ) => {
    const key = `fp-pol-${randomUUID()}`;
    await authz.permissionSets.create({ key, grants: [] });
    await authz.permissionSets.assign({
      permissionSet: key,
      subject: { type: 'user', id: userId },
    });
    const response = await admin.fetch(
      '/field-policies',
      json({
        permissionSetKey: key,
        requestKey: randomUUID(),
        policies,
      }),
    );
    expect(response.status).toBe(200);
  };

  const subject = await create<{ id: string }>('/organization/subjects', {
    code: `FP-${randomUUID().slice(0, 6)}`,
    name: 'Field policy company',
    type: 'group',
  });
  const incident = await create<{
    id: string;
    version: number;
    incidentNo: string;
    description: string;
  }>('/hse/incidents', {
    subjectId: subject.id,
    occurredAt: new Date().toISOString(),
    type: 'injury',
    severity: 'minor',
    location: 'Gate 3',
    description: 'Initial description',
    injuryCount: 0,
    lostDays: 0,
  });
  expect(incident.incidentNo).toMatch(/^HSE-INC-\d{8}-[A-F0-9]{4}$/);

  const period = '2026-11';
  const seededTarget = await send(
    admin,
    '/operations/targets',
    {
      subjectId: subject.id,
      period,
      metric: 'processed',
      targetValue: '120',
    },
    'PUT',
  );
  expect(seededTarget.status).toBe(200);
  const seededTargetValue = (
    (await seededTarget.json()) as { data: { targetValue: string } }
  ).data.targetValue;

  const issue = await create<{ id: string; version: number; title: string }>(
    '/operations/issues',
    {
      subjectId: subject.id,
      sourceType: 'other',
      title: 'Policy issue',
      description: 'Visible unless hidden',
      severity: 'medium',
      ownerName: 'Operations owner',
      dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    },
  );

  const hseUser = await makeUser('HSE policy manager', [
    { resource: 'hse', actions: ['read', 'manage', 'readAll'] },
  ]);
  await savePolicies(
    hseUser.id,
    policiesFor('hse.incident', incidentFields, ['location']),
  );

  const hseList = await hseUser.client.fetch(
    `/hse/incidents?subjectId=${subject.id}`,
  );
  expect(hseList.status).toBe(200);
  const hseRows = (
    (await hseList.json()) as { data: Array<Record<string, unknown>> }
  ).data;
  const hseRow = hseRows.find((row) => row.id === incident.id);
  expect(hseRow).toBeTruthy();
  expect(hseRow).not.toHaveProperty('location');
  expect(hseRow).toHaveProperty('incidentNo', incident.incidentNo);
  expect(hseRow).toHaveProperty('description', 'Initial description');
  expect(Array.isArray(hseRow!.history)).toBe(true);

  const rejectedCreate = await send(hseUser.client, '/hse/incidents', {
    subjectId: subject.id,
    occurredAt: new Date().toISOString(),
    type: 'injury',
    severity: 'minor',
    location: 'Hidden place',
    description: 'A hidden location must be rejected',
    injuryCount: 0,
    lostDays: 0,
  });
  expect(rejectedCreate.status).toBe(403);
  expect(await rejectedCreate.text()).toContain('FIELD_NOT_WRITABLE');

  const rejectedPatch = await send(
    hseUser.client,
    `/hse/incidents/${incident.id}`,
    { version: incident.version, location: 'Moved' },
    'PATCH',
  );
  expect(rejectedPatch.status).toBe(403);
  expect(await rejectedPatch.text()).toContain('FIELD_NOT_WRITABLE');

  const allowedPatch = await send(
    hseUser.client,
    `/hse/incidents/${incident.id}`,
    {
      version: incident.version,
      description: 'Description submitted through the field policy test',
    },
    'PATCH',
  );
  expect(allowedPatch.status).toBe(200);
  const patchedIncident = (
    (await allowedPatch.json()) as {
      data: Record<string, unknown> & { version: number };
    }
  ).data;
  expect(patchedIncident).not.toHaveProperty('location');
  expect(patchedIncident).toHaveProperty('incidentNo', incident.incidentNo);

  const transition = await send(
    hseUser.client,
    `/hse/incidents/${incident.id}/transitions`,
    { version: patchedIncident.version, action: 'investigate' },
  );
  expect(transition.status).toBe(200);
  const investigated = (
    (await transition.json()) as {
      data: Record<string, unknown> & { history?: unknown[] };
    }
  ).data;
  expect(investigated).not.toHaveProperty('location');
  expect(investigated).toHaveProperty('status', 'investigating');
  expect(Array.isArray(investigated.history)).toBe(true);

  const operationsUser = await makeUser('Operations policy manager', [
    { resource: 'operations', actions: ['read', 'manage', 'readAll'] },
  ]);
  await savePolicies(operationsUser.id, [
    ...policiesFor('operations.target', targetFields, ['targetValue']),
    ...policiesFor('operations.issue', issueFields, ['description']),
  ]);

  const targetList = await operationsUser.client.fetch(
    `/operations/targets?subjectId=${subject.id}&period=${period}`,
  );
  expect(targetList.status).toBe(200);
  const targetRows = (
    (await targetList.json()) as {
      data: { items: Array<Record<string, unknown>> };
    }
  ).data.items;
  const targetRow = targetRows.find((row) => row.metric === 'processed');
  expect(targetRow).toBeTruthy();
  expect(targetRow).not.toHaveProperty('targetValue');
  expect(targetRow).toHaveProperty('period', period);
  expect(targetRow).toHaveProperty('metric', 'processed');

  const rejectedTarget = await send(
    operationsUser.client,
    '/operations/targets',
    {
      subjectId: subject.id,
      period,
      metric: 'processed',
      targetValue: '999',
    },
    'PUT',
  );
  expect(rejectedTarget.status).toBe(403);
  expect(await rejectedTarget.text()).toContain('FIELD_NOT_WRITABLE');

  const allowedTarget = await send(
    operationsUser.client,
    '/operations/targets',
    {
      subjectId: subject.id,
      period,
      metric: 'processed',
      targetValue: seededTargetValue,
    },
    'PUT',
  );
  expect(allowedTarget.status).toBe(200);
  const savedTarget = (
    (await allowedTarget.json()) as { data: Record<string, unknown> }
  ).data;
  expect(savedTarget).not.toHaveProperty('targetValue');
  expect(savedTarget).toHaveProperty('metric', 'processed');

  const issueList = await operationsUser.client.fetch('/operations/issues');
  expect(issueList.status).toBe(200);
  const issueRows = (
    (await issueList.json()) as {
      data: { items: Array<Record<string, unknown>> };
    }
  ).data.items;
  const issueRow = issueRows.find((row) => row.id === issue.id);
  expect(issueRow).toBeTruthy();
  expect(issueRow).not.toHaveProperty('description');
  expect(issueRow).toHaveProperty('title', issue.title);

  const rejectedIssue = await send(
    operationsUser.client,
    '/operations/issues',
    {
      subjectId: subject.id,
      sourceType: 'other',
      title: 'Hidden description issue',
      description: 'This description may not be written',
      severity: 'medium',
      ownerName: 'Operations owner',
      dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    },
  );
  expect(rejectedIssue.status).toBe(403);
  expect(await rejectedIssue.text()).toContain('FIELD_NOT_WRITABLE');

  const allowedIssue = await send(
    operationsUser.client,
    `/operations/issues/${issue.id}`,
    { version: issue.version, severity: 'high' },
    'PATCH',
  );
  expect(allowedIssue.status).toBe(200);
  const patchedIssue = (
    (await allowedIssue.json()) as { data: Record<string, unknown> }
  ).data;
  expect(patchedIssue).not.toHaveProperty('description');
  expect(patchedIssue).toHaveProperty('severity', 'high');

  // A user without appFieldPolicies keeps the unchanged response shape.
  const plainUser = await makeUser('Plain operations reader', [
    { resource: 'hse', actions: ['read', 'readAll'] },
    { resource: 'operations', actions: ['read', 'readAll'] },
  ]);
  const plainHse = await plainUser.client.fetch(
    `/hse/incidents?subjectId=${subject.id}`,
  );
  expect(plainHse.status).toBe(200);
  const plainHseRow = (
    (await plainHse.json()) as { data: Array<Record<string, unknown>> }
  ).data.find((row) => row.id === incident.id);
  expect(plainHseRow).toBeTruthy();
  expect(plainHseRow).toHaveProperty('location');

  const plainTargets = await plainUser.client.fetch(
    `/operations/targets?subjectId=${subject.id}&period=${period}`,
  );
  expect(plainTargets.status).toBe(200);
  const plainTargetRow = (
    (await plainTargets.json()) as {
      data: { items: Array<Record<string, unknown>> };
    }
  ).data.items.find((row) => row.metric === 'processed');
  expect(plainTargetRow).toBeTruthy();
  expect(plainTargetRow).toHaveProperty('targetValue');
});

test('HSE workflow actions enforce field policies on the fields they write', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const authz = testApp.application.container.resolve(authorizationToken);

  const send = async (
    client: Client,
    path: string,
    body: unknown,
    method = 'POST',
  ) => client.fetch(path, json(body, method));
  const create = async <T>(path: string, body: unknown): Promise<T> => {
    const response = await send(admin, path, body);
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { data: T };
    return payload.data;
  };
  const makeUser = async (
    name: string,
    settings: { resource: string; actions: string[] }[],
  ) => {
    const email = `${randomUUID()}@example.test`;
    const password = randomUUID();
    const account = await users.create({ name, email, password });
    const role = await authz.permissionSets.create({
      key: `fp-${randomUUID()}`,
      title: name,
      grants: settings.map(({ resource, actions }) => ({
        resource: { type: 'settings' as const, id: resource },
        actions: actions.map((action) => ({ action })),
      })),
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
  const savePolicies = async (
    userId: string,
    policies: { resource: string; field: string; access: string }[],
  ) => {
    const key = `fp-pol-${randomUUID()}`;
    await authz.permissionSets.create({ key, grants: [] });
    await authz.permissionSets.assign({
      permissionSet: key,
      subject: { type: 'user', id: userId },
    });
    const response = await admin.fetch(
      '/field-policies',
      json({ permissionSetKey: key, requestKey: randomUUID(), policies }),
    );
    expect(response.status).toBe(200);
  };

  const subject = await create<{ id: string }>('/organization/subjects', {
    code: `FPT-${randomUUID().slice(0, 6)}`,
    name: 'Field policy transitions company',
    type: 'group',
  });
  const incident = await create<{ id: string; version: number }>(
    '/hse/incidents',
    {
      subjectId: subject.id,
      occurredAt: new Date().toISOString(),
      type: 'injury',
      severity: 'minor',
      location: 'Gate 4',
      description: 'Transition policy incident',
      injuryCount: 0,
      lostDays: 0,
    },
  );
  const investigation = await send(
    admin,
    `/hse/incidents/${incident.id}/transitions`,
    { version: incident.version, action: 'investigate' },
  );
  expect(investigation.status).toBe(200);
  const investigated = (
    (await investigation.json()) as { data: { version: number } }
  ).data;

  const certificate = await create<{ id: string; version: number }>(
    '/hse/certificates',
    {
      subjectId: subject.id,
      holderType: 'company',
      holderName: 'Field policy company',
      certType: 'safety',
      certNo: `FPT-${randomUUID().slice(0, 6)}`,
      issuedAt: '2026-01-01',
      expiresAt: '2026-12-31',
      authority: 'Authority',
    },
  );

  const hseUser = await makeUser('HSE transition manager', [
    { resource: 'hse', actions: ['read', 'manage', 'readAll'] },
  ]);
  await savePolicies(hseUser.id, [
    ...policiesFor('hse.incident', incidentFields, ['rootCause']),
    ...policiesFor(
      'hse.certificate',
      [
        'holderType',
        'holderName',
        'certType',
        'certNo',
        'issuedAt',
        'expiresAt',
        'authority',
        'status',
      ],
      ['expiresAt'],
    ),
  ]);

  const rejectedRectify = await send(
    hseUser.client,
    `/hse/incidents/${incident.id}/transitions`,
    {
      version: investigated.version,
      action: 'rectify',
      rootCause: 'Hidden root cause',
      actions: 'Corrective action',
    },
  );
  expect(rejectedRectify.status).toBe(403);
  expect(await rejectedRectify.text()).toContain('FIELD_NOT_WRITABLE');

  const rejectedRenew = await send(
    hseUser.client,
    `/hse/certificates/${certificate.id}/transitions`,
    {
      version: certificate.version,
      action: 'renew',
      expiresAt: '2027-12-31',
      authority: 'Authority',
      note: 'Renew',
    },
  );
  expect(rejectedRenew.status).toBe(403);
  expect(await rejectedRenew.text()).toContain('FIELD_NOT_WRITABLE');
});

const inspectionFields = [
  'type',
  'plannedAt',
  'inspectorId',
  'checklist',
  'findingsCount',
  'completedAt',
  'status',
];

test('HSE inspection records enforce field policies', async ({ testApp }) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const authz = testApp.application.container.resolve(authorizationToken);
  const send = async (
    client: Client,
    path: string,
    body: unknown,
    method = 'POST',
  ) => client.fetch(path, json(body, method));
  const create = async <T>(path: string, body: unknown): Promise<T> => {
    const response = await send(admin, path, body);
    expect(response.status).toBe(201);
    return ((await response.json()) as { data: T }).data;
  };
  const makeUser = async (name: string) => {
    const email = `${randomUUID()}@example.test`;
    const password = randomUUID();
    const account = await users.create({ name, email, password });
    const role = await authz.permissionSets.create({
      key: `fp-${randomUUID()}`,
      title: name,
      grants: [
        {
          resource: { type: 'settings' as const, id: 'hse' },
          actions: [
            { action: 'read' },
            { action: 'manage' },
            { action: 'readAll' },
          ],
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
  const savePolicies = async (
    userId: string,
    policies: { resource: string; field: string; access: string }[],
  ) => {
    const key = `fp-pol-${randomUUID()}`;
    await authz.permissionSets.create({ key, grants: [] });
    await authz.permissionSets.assign({
      permissionSet: key,
      subject: { type: 'user', id: userId },
    });
    const response = await admin.fetch(
      '/field-policies',
      json({ permissionSetKey: key, requestKey: randomUUID(), policies }),
    );
    expect(response.status).toBe(200);
  };

  const subject = await create<{ id: string }>('/organization/subjects', {
    code: `FPI-${randomUUID().slice(0, 6)}`,
    name: 'Inspection policy company',
    type: 'group',
  });
  const planned = await create<{ id: string; version: number }>(
    '/hse/inspections',
    {
      subjectId: subject.id,
      type: 'routine',
      plannedAt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      checklist: ['Check guards', 'Verify signage'],
    },
  );

  const user = await makeUser('Inspection policy manager');
  await savePolicies(
    user.id,
    policiesFor('hse.inspection', inspectionFields, ['inspectorId']),
  );

  const blocked = await user.client.fetch(
    '/hse/inspections',
    json(
      {
        subjectId: subject.id,
        type: 'routine',
        plannedAt: new Date(Date.now() + 2 * 86_400_000)
          .toISOString()
          .slice(0, 10),
        inspectorId: 'someone',
        checklist: ['Check guards'],
      },
      'POST',
    ),
  );
  expect(blocked.status).toBe(403);
  expect(
    ((await blocked.json()) as { error: { reason: string } }).error.reason,
  ).toBe('FIELD_NOT_WRITABLE');

  const listed = await user.client.fetch(
    `/hse/inspections?subjectId=${subject.id}`,
    { method: 'GET', headers: { origin: 'http://localhost' } },
  );
  expect(listed.status).toBe(200);
  const rows = ((await listed.json()) as { data: Record<string, unknown>[] })
    .data;
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) expect('inspectorId' in row).toBe(false);

  // A hidden field echoed as null must not clear the stored value...
  const nullPatch = await user.client.fetch(
    `/hse/inspections/${planned.id}`,
    json({ version: planned.version, inspectorId: null }, 'PATCH'),
  );
  expect(nullPatch.status).toBe(200);

  // ...while a concrete value for the hidden field is still rejected.
  const hiddenPatch = await user.client.fetch(
    `/hse/inspections/${planned.id}`,
    json({ version: planned.version + 1, inspectorId: 'someone' }, 'PATCH'),
  );
  expect(hiddenPatch.status).toBe(403);
  expect(
    ((await hiddenPatch.json()) as { error: { reason: string } }).error.reason,
  ).toBe('FIELD_NOT_WRITABLE');

  const done = await user.client.fetch(
    `/hse/inspections/${planned.id}/transitions`,
    json(
      { version: planned.version + 1, action: 'complete', findingsCount: 2 },
      'POST',
    ),
  );
  expect(done.status).toBe(200);
  expect(
    ((await done.json()) as { data: { status: string; findingsCount: number } })
      .data,
  ).toMatchObject({ status: 'completed', findingsCount: 2 });
});

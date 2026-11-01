// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import { databaseManagerToken } from '@nocobase/db';
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

test('reads an operations overview scoped to one company', async ({
  testApp,
  request,
}) => {
  expect((await request('/operations/overview')).status).toBe(401);
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const emptyIssues = await admin.fetch('/operations/issues');
  expect(emptyIssues.status).toBe(200);
  expect((await emptyIssues.json()).data.total).toBe(0);
  const create = async (path: string, body: unknown) => {
    const response = await admin.fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    expect(response.status).toBe(201);
    return payload.data;
  };
  const subject = await create('/organization/subjects', {
    code: `OPS-${randomUUID().slice(0, 6)}`,
    name: 'Operations test company',
    type: 'group',
  });
  const unit = await create('/organization/units', {
    code: `OPS-U-${randomUUID().slice(0, 6)}`,
    name: 'Operations test line',
    type: 'department',
    subjectId: subject.id,
  });
  await create('/hse/incidents', {
    subjectId: subject.id,
    unitId: unit.id,
    occurredAt: new Date().toISOString(),
    type: 'near_miss',
    severity: 'minor',
    location: 'Conveyor',
    description: 'Near miss while clearing a jam',
  });
  const issueResponse = await admin.fetch('/operations/issues', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
    body: JSON.stringify({
      subjectId: subject.id,
      sourceType: 'production',
      title: 'Metal output below plan',
      description: 'Check the magnetic separator',
      severity: 'high',
      ownerName: 'Line supervisor',
      dueAt: new Date().toISOString().slice(0, 10),
    }),
  });
  expect(issueResponse.status).toBe(201);
  const issue = (await issueResponse.json()).data;
  expect(issue.code).toMatch(/^OPS-\d{8}-[A-F0-9]{4}$/);
  const issues = await admin.fetch(
    `/operations/issues?subjectId=${subject.id}`,
  );
  expect((await issues.json()).data.total).toBe(1);
  const closedResponse = await admin.fetch(`/operations/issues/${issue.id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
    body: JSON.stringify({
      version: issue.version,
      status: 'closed',
      resolution: 'Separator adjusted',
    }),
  });
  expect(closedResponse.status).toBe(200);
  expect((await closedResponse.json()).data.status).toBe('closed');
  const period = new Date().toISOString().slice(0, 7);
  const targetResponse = await admin.fetch('/operations/targets', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
    body: JSON.stringify({
      subjectId: subject.id,
      period,
      metric: 'metal',
      targetValue: '120.5',
    }),
  });
  expect(targetResponse.status).toBe(200);
  expect((await targetResponse.json()).data.targetValue).toBe('120.5');
  const targets = await admin.fetch(
    `/operations/targets?subjectId=${subject.id}&period=${period}`,
  );
  const targetPage = (await targets.json()).data;
  expect(targetPage.items).toHaveLength(1);
  expect(targetPage.items[0].metric).toBe('metal');

  const db = testApp.application.container.resolve(databaseManagerToken);
  const now = new Date();
  await db.repository('prdShiftReports').createOne({
    values: {
      id: randomUUID(),
      subjectId: subject.id,
      unitId: unit.id,
      reportDate: `${period}-15`,
      shift: 'day',
      status: 'confirmed',
      processedQuantity: '10',
      metalQuantity: '5',
      sandQuantity: '4',
      tailingsQuantity: '1',
      runtimeMinutes: 480,
      downtimeMinutes: 0,
      notes: '',
      confirmedBy: 'operations-test',
      confirmedAt: now,
      version: 1,
      createdBy: 'operations-test',
      updatedBy: 'operations-test',
      createdAt: now,
      updatedAt: now,
    },
  });
  const withActual = await admin.fetch(
    `/operations/targets?subjectId=${subject.id}&period=${period}`,
  );
  const actualTarget = (await withActual.json()).data.items[0];
  expect(actualTarget.actualValue).toBe('5');
  expect(actualTarget.achievementPct).toBe('4.1');
  expect(actualTarget.status).toBe('behind');
  const response = await admin.fetch(
    `/operations/overview?subjectId=${subject.id}`,
  );
  if (response.status !== 200)
    throw new Error(`${response.status}: ${await response.text()}`);
  const overview = (await response.json()).data;
  expect(overview.subjectName).toBe('Operations test company');
  expect(overview.hse.incidentsOpen).toBe(1);
  expect(overview.production.reports).toBe(0);
  expect(overview.warehouse.stockConfigured).toBe(false);
  expect(overview.sales).toEqual({ openOrders: 0, shippedToday: 0 });
  expect(overview.procurement).toEqual({
    openOrders: 0,
    receivedToday: 0,
  });
  expect(overview.people).toEqual({ active: 0, production: 0 });
  expect(overview.issues).toEqual({ open: 0, overdue: 0 });
  expect(overview.notes.peopleScope).toBe('active_primary_assignment');
  expect(overview.units).toEqual([]);
  const companyCards = await admin.fetch('/operations/company-overview');
  expect(companyCards.status).toBe(200);
  const cards = (await companyCards.json()).data;
  const companyCard = cards.items.find(
    (item: { subjectId: string }) => item.subjectId === subject.id,
  );
  expect(companyCard).toMatchObject({
    subjectName: 'Operations test company',
    hse: { incidentsOpen: 1 },
    production: { reports: 0 },
  });
  const options = await admin.fetch('/operations/options');
  expect(options.status).toBe(200);
  expect((await options.json()).data.subjects).toContainEqual({
    id: subject.id,
    name: 'Operations test company',
  });
});

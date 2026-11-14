// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import { databaseManagerToken } from '@nocobase/db';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { createStandaloneServer } from '../../server/standalone.js';
import { businessDate } from '../../server/providers/business-date.js';
import { OperationsService } from '../../server/providers/operations-service.js';
import {
  executionCompanyCollections,
  inventoryResource,
} from '../../server/providers/execution-resources.js';

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
  const closedIssue = (await closedResponse.json()).data;
  expect(closedIssue.status).toBe('closed');
  expect(closedIssue.closedAt).not.toBeNull();
  const patch = (version: number, body: Record<string, unknown>) =>
    admin.fetch(`/operations/issues/${issue.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ version, ...body }),
    });
  const reopenResponse = await patch(closedIssue.version, {
    status: 'open',
  });
  expect(reopenResponse.status).toBe(400);
  const reopenError = await reopenResponse.json();
  expect(reopenError.error.reason).toBe('OPERATIONS_CONFLICT');
  expect(reopenError.error.message).toBe('ISSUE_CLOSED_IMMUTABLE');
  const editClosedResponse = await patch(closedIssue.version, {
    severity: 'low',
  });
  expect(editClosedResponse.status).toBe(400);
  expect((await editClosedResponse.json()).error.message).toBe(
    'ISSUE_CLOSED_IMMUTABLE',
  );
  const secondIssueResponse = await admin.fetch('/operations/issues', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
    body: JSON.stringify({
      subjectId: subject.id,
      sourceType: 'warehouse',
      title: 'Count mismatch',
      description: 'Reconcile the sand yard',
      severity: 'medium',
      ownerName: 'Store keeper',
      dueAt: new Date().toISOString().slice(0, 10),
    }),
  });
  expect(secondIssueResponse.status).toBe(201);
  const secondIssue = (await secondIssueResponse.json()).data;
  const unknownOwnerResponse = await admin.fetch('/operations/issues', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
    body: JSON.stringify({
      subjectId: subject.id,
      sourceType: 'production',
      title: 'Unknown owner position',
      description: 'Must be rejected',
      severity: 'low',
      ownerName: 'Ghost',
      ownerId: randomUUID(),
      dueAt: new Date().toISOString().slice(0, 10),
    }),
  });
  expect(unknownOwnerResponse.status).toBe(400);
  expect((await unknownOwnerResponse.json()).error.message).toBe(
    'OWNER_NOT_FOUND',
  );
  const secondPatch = (body: Record<string, unknown>) =>
    admin.fetch(`/operations/issues/${secondIssue.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
  const progressResponse = await secondPatch({
    version: secondIssue.version,
    status: 'in_progress',
  });
  expect(progressResponse.status).toBe(200);
  const inProgress = (await progressResponse.json()).data;
  expect(inProgress.status).toBe('in_progress');
  const closeNoResolution = await secondPatch({
    version: inProgress.version,
    status: 'closed',
  });
  expect(closeNoResolution.status).toBe(400);
  expect((await closeNoResolution.json()).error.message).toBe(
    'RESOLUTION_REQUIRED',
  );
  const reopenProgress = await secondPatch({
    version: inProgress.version,
    status: 'open',
  });
  expect(reopenProgress.status).toBe(200);
  const reopenedIssue = (await reopenProgress.json()).data;
  expect(reopenedIssue.status).toBe('open');
  const illegalJump = await secondPatch({
    version: reopenedIssue.version,
    status: 'closed',
    resolution: 'Done',
  });
  expect(illegalJump.status).toBe(200);
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
  const savedTarget = (await targetResponse.json()).data;
  expect(savedTarget.targetValue).toBe('120.5');
  const targetId = savedTarget.id;
  const targets = await admin.fetch(
    `/operations/targets?subjectId=${subject.id}&period=${period}`,
  );
  const targetPage = (await targets.json()).data;
  expect(targetPage.total).toBe(1);
  expect(targetPage.items).toHaveLength(1);
  expect(targetPage.items[0].metric).toBe('metal');

  const db = testApp.application.container.resolve(databaseManagerToken);
  const now = new Date();
  // Mid-month so the target actual aggregates, but never "today": the overview
  // counts only today's reports and this fixture asserts a zero count.
  const awayFromToday =
    businessDate() === `${period}-01` ? `${period}-02` : `${period}-01`;
  await db.repository('prdShiftReports').createOne({
    values: {
      id: randomUUID(),
      subjectId: subject.id,
      unitId: unit.id,
      reportDate: awayFromToday,
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

  // Every target save leaves an immutable history row in the same
  // transaction, so overwrites can always be audited.
  const firstHistory = await db.repository('opsKpiTargetHistory').findMany({
    filter: { targetId },
    sort: (sort) => [sort.field('createdAt').asc()],
  });
  expect(firstHistory).toHaveLength(1);
  expect(firstHistory[0].beforeValue).toBeNull();
  expect(firstHistory[0].afterValue).toEqual({
    targetValue: '120.5',
    version: 1,
  });
  expect(firstHistory[0].version).toBe(1);
  expect(firstHistory[0].actorId).toBeTruthy();
  const secondTargetResponse = await admin.fetch('/operations/targets', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
    body: JSON.stringify({
      subjectId: subject.id,
      period,
      metric: 'metal',
      targetValue: '130',
    }),
  });
  expect(secondTargetResponse.status).toBe(200);
  expect((await secondTargetResponse.json()).data.targetValue).toBe('130');
  const historyAfterUpdate = await db
    .repository('opsKpiTargetHistory')
    .findMany({
      filter: { targetId },
      sort: (sort) => [sort.field('createdAt').asc()],
    });
  expect(historyAfterUpdate).toHaveLength(2);
  expect(historyAfterUpdate[1].beforeValue).toMatchObject({
    targetValue: '120.5',
    version: 1,
  });
  expect(historyAfterUpdate[1].afterValue).toEqual({
    targetValue: '130',
    version: 2,
  });
  expect(historyAfterUpdate[1].version).toBe(2);
  const updatedTargets = await admin.fetch(
    `/operations/targets?subjectId=${subject.id}&period=${period}`,
  );
  const updatedTargetPage = (await updatedTargets.json()).data;
  expect(updatedTargetPage.items[0].targetValue).toBe('130');
  expect(updatedTargetPage.items[0].version).toBe(2);
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
  expect(overview.notes.truncated).toEqual([]);
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

  // The batched company overview loads all tables once and groups rows per
  // company: a second company's own report must land in its own card only.
  const secondSubject = await create('/organization/subjects', {
    code: `OPS-${randomUUID().slice(0, 6)}`,
    name: 'Operations test company two',
    type: 'group',
  });
  const secondUnit = await create('/organization/units', {
    code: `OPS-U-${randomUUID().slice(0, 6)}`,
    name: 'Operations test line two',
    type: 'department',
    subjectId: secondSubject.id,
  });
  await db.repository('prdShiftReports').createOne({
    values: {
      id: randomUUID(),
      subjectId: secondSubject.id,
      unitId: secondUnit.id,
      reportDate: businessDate(),
      shift: 'day',
      status: 'confirmed',
      processedQuantity: '2',
      metalQuantity: '1',
      sandQuantity: '1',
      tailingsQuantity: '0',
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
  const batchCardsResponse = await admin.fetch('/operations/company-overview');
  expect(batchCardsResponse.status).toBe(200);
  const batchCards = (await batchCardsResponse.json()).data;
  const firstCard = batchCards.items.find(
    (item: { subjectId: string }) => item.subjectId === subject.id,
  );
  const secondCard = batchCards.items.find(
    (item: { subjectId: string }) => item.subjectId === secondSubject.id,
  );
  expect(secondCard).toBeDefined();
  expect(firstCard).toBeDefined();
  expect(secondCard.production.reports).toBe(1);
  expect(secondCard.production.processed).toBe('2');

  // A third company: the batch keeps loading every table once and bucketing
  // rows per company, so its report must only count in its own card.
  const thirdSubject = await create('/organization/subjects', {
    code: `OPS-${randomUUID().slice(0, 6)}`,
    name: 'Operations test company three',
    type: 'group',
  });
  const thirdUnit = await create('/organization/units', {
    code: `OPS-U-${randomUUID().slice(0, 6)}`,
    name: 'Operations test line three',
    type: 'department',
    subjectId: thirdSubject.id,
  });
  await db.repository('prdShiftReports').createOne({
    values: {
      id: randomUUID(),
      subjectId: thirdSubject.id,
      unitId: thirdUnit.id,
      reportDate: businessDate(),
      shift: 'day',
      status: 'confirmed',
      processedQuantity: '3',
      metalQuantity: '1.5',
      sandQuantity: '1',
      tailingsQuantity: '0.5',
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
  const threeCardsResponse = await admin.fetch('/operations/company-overview');
  expect(threeCardsResponse.status).toBe(200);
  const threeCards = (await threeCardsResponse.json()).data;
  expect(threeCards.items).toHaveLength(3);
  const thirdCard = threeCards.items.find(
    (item: { subjectId: string }) => item.subjectId === thirdSubject.id,
  );
  expect(thirdCard).toBeDefined();
  expect(thirdCard.production.reports).toBe(1);
  expect(thirdCard.production.processed).toBe('3');
  expect(
    threeCards.items.find(
      (item: { subjectId: string }) => item.subjectId === secondSubject.id,
    ).production.processed,
  ).toBe('2');
  const options = await admin.fetch('/operations/options');
  expect(options.status).toBe(200);
  expect((await options.json()).data.subjects).toContainEqual({
    id: subject.id,
    name: 'Operations test company',
  });

  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const authz = testApp.application.container.resolve(authorizationToken);
  const email = `${randomUUID()}@example.test`;
  const password = randomUUID();
  const account = await users.create({
    name: 'Operations-only viewer',
    email,
    password,
  });
  const role = await authz.permissionSets.create({
    key: `ops-${randomUUID()}`,
    title: 'Operations-only viewer',
    grants: [
      {
        resource: { type: 'settings', id: 'operations' },
        actions: [{ action: 'read' }, { action: 'readAll' }],
      },
    ],
  });
  await authz.permissionSets.assign({
    permissionSet: role.key,
    subject: { type: 'user', id: account.id },
  });
  const viewer = await signIn(testApp, { email, password });
  const maskedResponse = await viewer.fetch(`/operations/overview`);
  expect(maskedResponse.status).toBe(200);
  const masked = (await maskedResponse.json()).data;
  expect(masked.production).toBeNull();
  expect(masked.warehouse).toBeNull();
  expect(masked.hse).toBeNull();
  expect(masked.sales).toBeNull();
  expect(masked.procurement).toBeNull();
  expect(masked.people).toBeNull();
  expect(masked.maintenance).toBeNull();
  expect(masked.downtime).toBeNull();
  expect(masked.units).toEqual([]);
  expect(masked.issues).toEqual({ open: 0, overdue: 0 });
  expect(masked.notes.maskedSources).toContain('hse');
  expect(masked.notes.maskedSources).toContain('production');
  expect(masked.notes.truncated).toEqual([]);
});

test('masks record-limited composite sources in the operations overview', async ({
  testApp,
  request,
}) => {
  expect((await request('/operations/overview')).status).toBe(401);
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
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
    name: 'Operations masked warehouse company',
    type: 'group',
  });
  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const authz = testApp.application.container.resolve(authorizationToken);
  const warehouseScopes = (subjectIds: string[] | null) =>
    Object.fromEntries(
      (
        inventoryResource.actions.find((item) => item.name === 'read')
          ?.dataScopes ?? []
      ).map(({ key }) => [
        key,
        subjectIds && executionCompanyCollections.includes(key)
          ? {
              type: 'recordAccess',
              key: 'execution.companies',
              params: { subjectIds },
            }
          : 'allRecords',
      ]),
    );
  const viewer = async (
    title: string,
    scopes: ReturnType<typeof warehouseScopes>,
    extraGrants: Parameters<
      typeof authz.permissionSets.create
    >[0]['grants'] = [],
  ) => {
    const email = `${randomUUID()}@example.test`;
    const password = randomUUID();
    const account = await users.create({ name: title, email, password });
    const role = await authz.permissionSets.create({
      key: `ops-${randomUUID()}`,
      title,
      grants: [
        {
          resource: { type: 'settings', id: 'operations' },
          actions: [{ action: 'read' }, { action: 'readAll' }],
        },
        {
          resource: { type: 'composite', id: 'warehouse.inventory' },
          actions: [
            { action: 'read', policy: { type: 'composite', scopes } },
          ],
        },
        ...extraGrants,
      ],
    });
    await authz.permissionSets.assign({
      permissionSet: role.key,
      subject: { type: 'user', id: account.id },
    });
    return signIn(testApp, { email, password });
  };

  // A record-limited warehouse.inventory read grant covers only its own
  // company's rows. The overview aggregates whole tables and cannot apply
  // record conditions, so the warehouse block must be masked instead of
  // leaking every company's stock.
  const limited = await viewer(
    'Record-limited warehouse viewer',
    warehouseScopes([subject.id]),
  );
  const limitedResponse = await limited.fetch('/operations/overview');
  expect(limitedResponse.status).toBe(200);
  const limitedOverview = (await limitedResponse.json()).data;
  expect(limitedOverview.warehouse).toBeNull();
  expect(limitedOverview.notes.maskedSources).toContain('warehouse');
  expect(limitedOverview.hse).toBeNull();
  expect(limitedOverview.production).toBeNull();
  expect(limitedOverview.sales).toBeNull();
  expect(limitedOverview.procurement).toBeNull();
  expect(limitedOverview.people).toBeNull();
  expect(limitedOverview.issues).toEqual({ open: 0, overdue: 0 });
  expect(limitedOverview.notes.truncated).toEqual([]);

  // An unrestricted warehouse.inventory read grant keeps the block.
  const unrestricted = await viewer(
    'Unrestricted warehouse viewer',
    warehouseScopes(null),
  );
  const unrestrictedResponse = await unrestricted.fetch(
    '/operations/overview',
  );
  expect(unrestrictedResponse.status).toBe(200);
  const unrestrictedOverview = (await unrestrictedResponse.json()).data;
  expect(unrestrictedOverview.warehouse).toEqual({
    receiptDraft: 0,
    receiptPending: 0,
    receiptPosted: 0,
    stockMetal: '0',
    stockSand: '0',
    stockConfigured: false,
  });
  expect(unrestrictedOverview.notes.maskedSources).not.toContain('warehouse');

  // A viewer allowed to read only some source modules gets a partial mask:
  // the visible blocks stay, and only the missing sources are reported.
  const partial = await viewer(
    'Partially granted viewer',
    warehouseScopes(null),
    [
      {
        resource: { type: 'settings', id: 'hse' },
        actions: [{ action: 'read' }],
      },
      {
        resource: { type: 'settings', id: 'production' },
        actions: [{ action: 'read' }],
      },
    ],
  );
  const partialResponse = await partial.fetch('/operations/overview');
  expect(partialResponse.status).toBe(200);
  const partialOverview = (await partialResponse.json()).data;
  expect(partialOverview.hse).not.toBeNull();
  expect(partialOverview.production).not.toBeNull();
  expect(partialOverview.warehouse).not.toBeNull();
  expect(partialOverview.sales).toBeNull();
  expect(partialOverview.procurement).toBeNull();
  expect(partialOverview.people).toBeNull();
  expect(partialOverview.notes.maskedSources.sort()).toEqual([
    'people',
    'procurement',
    'sales',
  ]);
  expect(partialOverview.notes.truncated).toEqual([]);
});

test('reports truncated sources only when a load exceeds its limit', async () => {
  const serviceFor = (rows: (limit: number) => number) =>
    new OperationsService(
      {
        repository: (name: string) => ({
          findMany: async ({ limit = 0 }: { limit?: number } = {}) =>
            name === 'prdShiftReports'
              ? Array.from({ length: rows(limit) }, () => ({}))
              : [],
        }),
      } as never,
      'Asia/Shanghai',
    );
  const principal = { type: 'user', id: 'tester' };

  const full = await serviceFor((requested) => requested - 1).overview(
    principal,
    {},
    { readAll: true },
  );
  expect(full.notes.truncated).not.toContain('production:reports');

  const over = await serviceFor((requested) => requested).overview(
    principal,
    {},
    { readAll: true },
  );
  expect(over.notes.truncated).toContain('production:reports');
});

test('loads company cards for more than 100 companies', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
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
  const created: string[] = [];
  for (let index = 0; index < 101; index += 1) {
    const subject = await create('/organization/subjects', {
      code: `OPS-B-${index}-${randomUUID().slice(0, 6)}`,
      name: `Batch company ${index}`,
      type: 'group',
    });
    created.push(subject.id);
  }
  const response = await admin.fetch('/operations/company-overview');
  expect(response.status).toBe(200);
  const data = (await response.json()).data;
  expect(data.items.length).toBeGreaterThan(100);
  const returned = new Set(
    data.items.map((item: { subjectId: string | null }) => item.subjectId),
  );
  for (const id of created) expect(returned.has(id)).toBe(true);
});

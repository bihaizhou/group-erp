// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import type { DatabaseConnection } from '@nocobase/db';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  apiDocsToken,
  findApiDocumentSchemaProblems,
  findUndeclaredApiRoutes,
} from '@nocobase/app-server/router';
import { createStandaloneServer } from '../../server/standalone.js';
import {
  fixture,
  mutation,
  send,
  purchaseMaterial,
} from '../helpers/purchase-requests.js';
import { purchaseReferenceImpact } from '../../server/providers/purchase-reference-service.js';
import { purchaseReadColumns } from '../../server/providers/purchase-request-resources.js';
import type { MaterialPolicies } from '../../server/providers/material-service.js';
import { businessDate } from '../../server/providers/business-date.js';

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
const impact = (domain: string, kind: string, id: string, subjectId?: string) =>
  `/procurement/referenceImpacts?${new URLSearchParams({ domain, kind, id, ...(subjectId ? { subjectId } : {}) })}`;
const policies = (): MaterialPolicies =>
  Object.fromEntries(
    Object.keys(purchaseReadColumns).map((table) => [
      table,
      { read: true, create: false, update: false, delete: false },
    ]),
  );

test('authenticates, checks target-domain permissions and scopes, validates contexts and documents the API', async ({
  testApp,
  database,
  request,
}) => {
  const f = await fixture(testApp, database);
  expect(
    (await request(impact('organization', 'subjects', f.a.id))).status,
  ).toBe(401);
  expect(
    (await f.agent.session.fetch(impact('organization', 'subjects', f.a.id)))
      .status,
  ).toBe(403);
  expect(
    (await f.admin.fetch(impact('organization', 'subjects', randomUUID())))
      .status,
  ).toBe(404);
  expect(
    (await f.admin.fetch(impact('organization', 'subjects', f.a.id, f.a.id)))
      .status,
  ).toBe(400);
  expect(
    (await f.admin.fetch(impact('suppliers', 'company', randomUUID()))).status,
  ).toBe(400);
  await f.authz.permissionSets.assign({
    permissionSet: 'company-personnel-maintainer',
    subject: { type: 'user', id: f.agent.user.id },
  });
  const outside = await f.create('/people/employees', {
    code: randomUUID(),
    name: 'Outside target',
    subjectId: f.b.id,
    data: {},
  });
  expect(
    (await f.agent.session.fetch(impact('people', 'employees', outside.id)))
      .status,
  ).toBe(404);
  expect(findUndeclaredApiRoutes(testApp.application)).toEqual([]);
  const doc = await testApp.application.container
    .resolve(apiDocsToken)
    .getDocument();
  expect(findApiDocumentSchemaProblems(doc)).toEqual([]);
  expect(
    doc.paths?.['/api/procurement/referenceImpacts']?.get?.operationId,
  ).toBe('getPurchaseReferenceImpacts');
});

test('never reveals hidden existence or counts and respects own-request, line, task and field policies', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  for (const person of [f.agent, f.applicant])
    await f.authz.permissionSets.assign({
      permissionSet: 'organization-reader',
      subject: { type: 'user', id: person.user.id },
    });
  const path = impact('organization', 'subjects', f.a.id);
  const before = await (await f.agent.session.fetch(path)).json();
  expect(before.data).toEqual({
    visibility: 'restricted',
    items: [],
    hasMore: false,
  });
  const own = await f.draft();
  expect((await (await f.agent.session.fetch(path)).json()).data).toEqual(
    before.data,
  );
  await f.grant(f.agent.user.id);
  const other = await f.draft(
    { ...f.content(), requesterEmployeeId: f.agent.employee.id },
    f.agent.session,
  );
  const visible = (await (await f.applicant.session.fetch(path)).json()).data;
  expect(visible).toMatchObject({ visibility: 'authorized', total: 1 });
  expect(visible.items.map((v: { id: string }) => v.id)).toEqual([own.id]);
  expect(JSON.stringify(visible)).not.toContain(other.id);
  const p = policies();
  p.purchaseRequests = {
    ...p.purchaseRequests,
    read: { fields: ['id', 'status'] },
  };
  expect(
    await purchaseReferenceImpact(
      database.connection(),
      { domain: 'organization', kind: 'subjects', id: f.a.id },
      undefined,
      p,
      'Asia/Shanghai',
    ),
  ).toEqual(before.data);
  const m = await purchaseMaterial(f, database);
  await f.draft(m.content);
  const linePolicy = policies();
  linePolicy.purchaseRequestLines = {
    read: false,
    create: false,
    update: false,
    delete: false,
  };
  expect(
    await purchaseReferenceImpact(
      database.connection(),
      { domain: 'materials', kind: 'skus', id: m.sku.id },
      undefined,
      linePolicy,
      'Asia/Shanghai',
    ),
  ).toEqual(before.data);
  const taskPolicy = policies();
  taskPolicy.supplyChainReviewTasks = {
    read: false,
    create: false,
    update: false,
    delete: false,
  };
  expect(
    await purchaseReferenceImpact(
      database.connection(),
      { domain: 'people', kind: 'employees', id: f.reviewer.employee.id },
      undefined,
      taskPolicy,
      'Asia/Shanghai',
    ),
  ).toEqual(before.data);
});

test('protects company retirement and department ownership atomically, and releases cancelled references', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  const company = await f.create('/organization/subjects', {
    code: randomUUID(),
    name: 'Reference-only company',
    type: 'group',
  });
  const unit = await f.create('/organization/units', {
    code: randomUUID(),
    name: 'Reference-only department',
    subjectId: company.id,
    type: 'department',
  });
  let row = await f.draft(
    {
      ...f.content(),
      subjectId: company.id,
      requesterEmployeeId: null,
      requestingUnitId: unit.id,
      lines: [],
    },
    f.admin,
  );
  const orgBefore = await database.repository('orgAudit').count();
  for (const [path, body] of [
    [
      `/organization/subjects/${company.id}/setStatus`,
      {
        status: 'inactive',
        version: company.version,
        reason: 'Retire referenced company',
      },
    ],
    [
      `/organization/units/${unit.id}/setStatus`,
      {
        status: 'inactive',
        version: unit.version,
        reason: 'Retire referenced unit',
      },
    ],
    [
      `/organization/units/${unit.id}`,
      {
        subjectId: f.b.id,
        version: unit.version,
        reason: 'Move referenced unit',
      },
    ],
  ] as const) {
    const r = await send(
      f.admin,
      path,
      body,
      path.endsWith('/setStatus') ? 'POST' : 'PATCH',
    );
    expect((await r.json()).error.reason).toBe('ORG_PURCHASE_DEPENDENTS');
    expect(r.status).toBe(400);
  }
  expect(await database.repository('orgAudit').count()).toBe(orgBefore);
  expect(
    (await database
      .repository('orgUnits')
      .findOne({ filter: { id: unit.id } }))!.subjectId,
  ).toBe(company.id);
  row = await f.fire(row, 'cancel', f.admin);
  expect(row.status).toBe('cancelled');
  const moved = await send(
    f.admin,
    `/organization/units/${unit.id}`,
    {
      subjectId: f.b.id,
      version: unit.version,
      reason: 'All requests cancelled',
    },
    'PATCH',
  );
  expect(moved.status).toBe(200);
  const retired = await send(
    f.admin,
    `/organization/subjects/${company.id}/setStatus`,
    {
      status: 'inactive',
      version: company.version,
      reason: 'No remaining references',
    },
    'POST',
  );
  expect(retired.status).toBe(200);
});

test('matches all material identities, excludes cancelled lines, caps visible examples and writes no facts during preview', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database),
    m = await purchaseMaterial(f, database);
  const row = await f.draft(m.content);
  const tables = [
    'orgMutationLock',
    'supplyChainMutationLock',
    'materialMutationLock',
    'purchaseRequests',
    'purchaseRequestLines',
    'supplyChainReviewTasks',
    'supplyChainRequestVersions',
    'supplyChainAudit',
    'materialAudit',
  ];
  const snapshot = () =>
    Promise.all(
      tables.map((table) =>
        database.repository(table).findMany({ limit: 10000 }),
      ),
    );
  const before = await snapshot();
  for (const [kind, id] of [
    ['templates', m.template.id],
    ['names', m.name.id],
    ['skus', m.sku.id],
    ['units', m.box.id],
    ['units', m.each.id],
    ['unitRules', m.pack.id],
    ['subjectSettings', m.admission.id],
  ]) {
    const r = await f.admin.fetch(impact('materials', kind, String(id)));
    expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({
      visibility: 'authorized',
      ...(kind === 'units' ? {} : { total: 1 }),
      items: expect.arrayContaining([expect.objectContaining({ id: row.id })]),
    });
  }
  expect(await snapshot()).toEqual(before);
  const removed = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}`,
    { content: { ...m.content, lines: [] }, ...mutation(row) },
    'PATCH',
  );
  expect(removed.status).toBe(200);
  expect(
    (await (await f.admin.fetch(impact('materials', 'skus', m.sku.id))).json())
      .data.total,
  ).toBe(0);
  for (let i = 0; i < 6; i++) await f.draft({ ...f.content(), lines: [] });
  const v = (
    await (
      await f.admin.fetch(impact('organization', 'subjects', f.a.id))
    ).json()
  ).data;
  expect(v.total).toBe(7);
  expect(v.items).toHaveLength(5);
  expect(v.hasMore).toBe(true);
});

test('supplier company and global contexts remain independent and stopping use preserves frozen request content', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  const supplier = await f.create('/procurement/suppliers', {
    subjectId: f.a.id,
    name: 'Referenced supplier',
    code: randomUUID(),
    notes: '',
    requestKey: randomUUID(),
  });
  await f.saveRules();
  const row = await f.fire(
    await f.draft({ ...f.content(), suggestedSupplierId: supplier.partnerId }),
    'submit',
  );
  for (const kind of ['identity', 'applicability', 'company']) {
    const r = await f.admin.fetch(
      impact(
        'suppliers',
        kind,
        supplier.partnerId,
        kind === 'company' ? f.a.id : undefined,
      ),
    );
    expect(r.status).toBe(200);
    expect((await r.json()).data.total).toBe(1);
  }
  const r = await send(
    f.admin,
    `/procurement/suppliers/${supplier.id}/deactivate`,
    {
      version: supplier.revision,
      lifecycleVersion: supplier.lifecycleVersion,
      requestKey: randomUUID(),
      reason: 'Stop referenced supplier',
    },
  );
  expect(r.status).toBe(200);
  const current = (
    await (await f.admin.fetch(`/procurement/requests/${row.id}`)).json()
  ).data;
  expect(current.versions).toEqual(row.versions);
  expect(current.reviewTasks).toEqual(row.reviewTasks);
  expect(current.supplierSnapshot).toEqual(row.supplierSnapshot);
});

test('personnel exit and current review handover are allowed while pending references and frozen facts stay intact', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.grant(f.agent.user.id);
  await f.saveRules(f.rules([f.reviewer.user.id, f.agent.user.id]));
  const row = await f.fire(await f.draft(), 'submit');
  for (const [kind, id] of [
    ['employees', f.applicant.employee.id],
    ['employees', f.reviewer.employee.id],
  ]) {
    const r = await f.admin.fetch(impact('people', kind, id));
    expect(r.status).toBe(200);
    expect(
      (await r.json()).data.items.map((v: { id: string }) => v.id),
    ).toContain(row.id);
  }
  const change = await f.create('/people/changes', {
    code: randomUUID(),
    name: 'Review employee exit',
    personId: f.reviewer.employee.id,
    data: {
      type: 'exit',
      effectiveDate: businessDate(),
      explanation: 'Isolated exit with pending review',
    },
  });
  expect(
    (await (await f.admin.fetch(impact('people', 'changes', change.id))).json())
      .data.total,
  ).toBe(1);
  let state = change;
  for (const transition of ['submit', 'approve']) {
    const response = await send(f.admin, `/people/changes/${state.id}/fire`, {
      transition,
      version: state.lifecycleVersion,
      requestId: randomUUID(),
      reason: 'Authorized employee exit',
    });
    expect(response.status).toBe(200);
    state = (await response.json()).data;
  }
  expect(state.status).toBe('effective');
  const current = (
    await (await f.admin.fetch(`/procurement/requests/${row.id}`)).json()
  ).data;
  expect(current.reviewTasks).toEqual(row.reviewTasks);
  expect(current.versions).toEqual(row.versions);
  const denied = await send(
    f.reviewer.session,
    `/procurement/requests/${row.id}/approve`,
    mutation(row),
  );
  // The exit disables the reviewer's account, so the session is rejected before the route can hide the record.
  expect(denied.status).toBe(401);
  expect((await f.fire(row, 'approve', f.agent.session)).status).toBe(
    'approved',
  );
});

test('PostgreSQL: global material maintenance waits for the purchase organization lock on a distinct connection', async ({
  testApp,
  database,
  skip,
}) => {
  if (database.connection().dialect !== 'postgres') skip();
  const f = await fixture(testApp, database),
    m = await purchaseMaterial(f, database);
  await f.saveRules();
  const row = await f.draft(m.content);
  const original = database.transaction.bind(database);
  const pids: number[] = [];
  let release!: () => void, firstReady!: () => void, secondReady!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = new Promise<void>((resolve) => {
    firstReady = resolve;
  });
  const second = new Promise<void>((resolve) => {
    secondReady = resolve;
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    release();
  }, 15000);
  const spy = vi
    .spyOn(database, 'transaction')
    .mockImplementation(
      async <T>(work: (c: DatabaseConnection) => Promise<T>, name?: string) =>
        original(async (c) => {
          const sql = await c.client<{
            raw(sql: string): Promise<{ rows: { pid: number }[] }>;
          }>();
          const { rows } = await sql.raw('select pg_backend_pid() as pid');
          pids.push(rows[0].pid);
          if (pids.length === 1) {
            await c.repository('orgMutationLock').updateOne({
              filter: { id: 'organization' },
              values: { nonce: randomUUID() },
            });
            firstReady();
            await gate;
          } else secondReady();
          return work(c);
        }, name),
    );
  let submit!: Response,
    edit!: Response,
    blocked = false;
  try {
    const submitting = send(
      f.applicant.session,
      `/procurement/requests/${row.id}/submit`,
      mutation(row),
    );
    await first;
    const editing = send(
      f.admin,
      `/materials/names/${m.name.id}`,
      {
        name: 'Coordinated name change',
        version: m.name.version,
        reason: 'Concurrent maintenance',
      },
      'PATCH',
    );
    await second;
    const sql = await database.connection().client<{
      raw(
        sql: string,
        values: number[],
      ): Promise<{ rows: { blockers: number[] }[] }>;
    }>();
    for (let i = 0; i < 50 && !blocked; i++) {
      const result = await sql.raw('select pg_blocking_pids(?) as blockers', [
        pids[1],
      ]);
      blocked = result.rows[0].blockers.includes(pids[0]);
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    release();
    [submit, edit] = await Promise.all([submitting, editing]);
  } finally {
    release();
    clearTimeout(timeout);
    spy.mockRestore();
  }
  expect(timedOut).toBe(false);
  expect(new Set(pids).size).toBe(2);
  expect(blocked).toBe(true);
  expect(submit.status).toBe(200);
  expect(edit.status).toBe(200);
  const current = (
    await (await f.admin.fetch(`/procurement/requests/${row.id}`)).json()
  ).data;
  expect(current.status).toBe('pending');
  expect(current.versions).toEqual((await submit.json()).data.versions);
  console.info(
    JSON.stringify({
      probe: 'purchase-material-organization-lock',
      backendPids: pids,
      blockedByOrganizationTransaction: blocked,
    }),
  );
});

test('intersects scoped lines and tasks with visible heads, restricts unreadable joins, and matches effective positions and regions', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database),
    m = await purchaseMaterial(f, database);
  const region = await f.create('/organization/regions', {
    code: randomUUID(),
    name: 'Reference region',
  });
  expect(
    (
      await send(
        f.admin,
        `/organization/subjects/${f.a.id}`,
        {
          version: f.a.version,
          regionId: region.id,
          reason: 'Region reference check',
        },
        'PATCH',
      )
    ).status,
  ).toBe(200);
  const supplier = await f.create('/procurement/suppliers', {
    subjectId: f.a.id,
    name: 'Regional reference supplier',
    code: randomUUID(),
    notes: '',
    requestKey: randomUUID(),
  });
  await f.saveRules();
  const row = await f.fire(
    await f.draft({ ...m.content, suggestedSupplierId: supplier.partnerId }),
    'submit',
  );
  for (const [kind, id] of [
    ['units', f.unit.id],
    ['positions', f.position.id],
    ['regions', region.id],
  ]) {
    const response = await f.admin.fetch(impact('organization', kind, id));
    expect(response.status).toBe(200);
    expect((await response.json()).data.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: row.id })]),
    );
  }
  const connection = database.connection(),
    p = policies();
  p.purchaseRequestLines = {
    ...p.purchaseRequestLines,
    read: {
      scope: { requestId: randomUUID() },
      fields: purchaseReadColumns.purchaseRequestLines,
    },
  };
  expect(
    await purchaseReferenceImpact(
      connection,
      { domain: 'materials', kind: 'skus', id: m.sku.id },
      undefined,
      p,
      'Asia/Shanghai',
    ),
  ).toMatchObject({ visibility: 'authorized', total: 0, items: [] });
  const tasks = policies();
  tasks.supplyChainReviewTasks = {
    ...tasks.supplyChainReviewTasks,
    read: {
      scope: { requestId: randomUUID() },
      fields: purchaseReadColumns.supplyChainReviewTasks,
    },
  };
  expect(
    await purchaseReferenceImpact(
      connection,
      { domain: 'people', kind: 'employees', id: f.reviewer.employee.id },
      undefined,
      tasks,
      'Asia/Shanghai',
    ),
  ).toMatchObject({ visibility: 'authorized', total: 0, items: [] });
  const heads = policies();
  heads.purchaseRequests = {
    ...heads.purchaseRequests,
    read: {
      scope: { id: randomUUID() },
      fields: purchaseReadColumns.purchaseRequests,
    },
  };
  expect(
    await purchaseReferenceImpact(
      connection,
      { domain: 'materials', kind: 'skus', id: m.sku.id },
      undefined,
      heads,
      'Asia/Shanghai',
    ),
  ).toMatchObject({ visibility: 'authorized', total: 0, items: [] });
  const restricted = { visibility: 'restricted', items: [], hasMore: false };
  const noFields = policies();
  noFields.purchaseRequestLines = {
    ...noFields.purchaseRequestLines,
    read: { scope: true },
  };
  expect(
    await purchaseReferenceImpact(
      connection,
      { domain: 'materials', kind: 'skus', id: m.sku.id },
      undefined,
      noFields,
      'Asia/Shanghai',
    ),
  ).toEqual(restricted);
  expect(
    await purchaseReferenceImpact(
      connection,
      { domain: 'materials', kind: 'subjectSettings', id: m.admission.id },
      {
        materialSubjectSettings: {
          read: { scope: true, fields: ['id'] },
          create: false,
          update: false,
          delete: false,
        },
      },
      policies(),
      'Asia/Shanghai',
    ),
  ).toEqual(restricted);
  await expect(
    purchaseReferenceImpact(
      connection,
      { domain: 'materials', kind: 'skus', id: m.sku.id },
      {},
      policies(),
      'Asia/Shanghai',
    ),
  ).rejects.toMatchObject({ reason: 'PURCHASE_REFERENCE_TARGET_UNAVAILABLE' });
});

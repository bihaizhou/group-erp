// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import type { DatabaseConnection } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  fixture,
  mutation,
  send,
  signIn,
} from '../helpers/purchase-requests.js';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import {
  apiDocsToken,
  findApiDocumentSchemaProblems,
  findUndeclaredApiRoutes,
} from '@nocobase/app-server/router';
import { createStandaloneServer } from '../../server/standalone.js';
import { purchaseRequestServiceToken } from '../../server/providers/procurement.js';
import { supplyChainMaterialServiceToken } from '../../server/providers/supply-chain.js';
import type { PurchaseContent } from '../../server/providers/purchase-request-model.js';
import type { MaterialPolicies } from '../../server/providers/material-service.js';
import { recordLifecycleToken } from '../../server/providers/record-lifecycle.js';
import { purchaseReadColumns } from '../../server/providers/purchase-request-resources.js';
import defaults from '../../database/main/seeds/202610180001_purchase_request_defaults.js';
import pageDefaults from '../../database/main/seeds/202610180002_purchase_request_page_defaults.js';

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
test('authenticates and authorizes all paths before input validation; page grants authorize no API', async ({
  testApp,
  request,
}) => {
  for (const path of [
    '/procurement/requests',
    '/procurement/requests/not-id/history',
    '/procurement/requestIdentity',
    '/procurement/merge',
    '/procurement/requestOptions',
    '/procurement/requestMaterialOptions',
    '/procurement/requestMaterialOptions/not-id',
    '/procurement/requestSupplierOptions',
    '/procurement/requests/not-id/capabilities',
    '/procurement/settings',
    '/procurement/settings/options',
  ])
    expect((await request(path)).status).toBe(401);
  const users = testApp.application.container.resolve(
      userAdministrationServiceToken,
    ),
    password = randomUUID();
  const user = await users.create({
    name: 'Page only',
    email: `${randomUUID()}@example.test`,
    password,
  });
  const session = await signIn(testApp, { email: user.email!, password });
  const authz = testApp.application.container.resolve(authorizationToken);
  const role = await authz.permissionSets.create({
    key: randomUUID(),
    title: 'Page only',
    grants: [
      {
        resource: { type: 'page', id: 'procurement-requests' },
        actions: [{ action: 'access' }],
      },
    ],
  });
  await authz.permissionSets.assign({
    permissionSet: role.key,
    subject: { type: 'user', id: user.id },
  });
  for (const path of [
    '/procurement/requests?unexpected=1',
    '/procurement/requestIdentity',
    '/procurement/merge',
    '/procurement/settings?unexpected=1',
    '/procurement/requestMaterialOptions?unexpected=1',
    '/procurement/requestMaterialOptions/not-id',
    '/procurement/requestSupplierOptions?unexpected=1',
    '/procurement/requests/not-id/capabilities',
  ])
    expect((await session.fetch(path)).status).toBe(403);
  for (const action of [
    'submit',
    'approve',
    'return',
    'withdraw',
    'revise',
    'cancel',
    'reassign',
    'copy',
  ])
    expect(
      (await send(session, `/procurement/requests/not-id/${action}`, {}))
        .status,
    ).toBe(403);
  expect((await send(session, '/procurement/settings', {}, 'PUT')).status).toBe(
    403,
  );
});

test('saves incomplete drafts without configured reviewers, while formal submission explains missing requirements', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  const row = await f.draft({
    ...f.content(),
    requesterEmployeeId: null,
    requestingUnitId: null,
    usage: '',
    neededOn: null,
    lines: [],
  } as never);
  expect(row.status).toBe('draft');
  expect(row.contentVersion).toBe(1);
  expect(
    await database.repository('supplyChainParameterSnapshots').count(),
  ).toBe(0);
  const response = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}/submit`,
    mutation(row),
  );
  expect(response.status).toBe(400);
  const full = await f.draft();
  const unconfigured = await send(
    f.applicant.session,
    `/procurement/requests/${full.id}/submit`,
    mutation(full),
  );
  expect((await unconfigured.json()).error.reason).toBe(
    'PURCHASE_REVIEWERS_EMPTY',
  );
  expect(
    await database.repository('supplyChainParameterSnapshots').count(),
  ).toBe(0);
  expect(await database.repository('supplyChainRequestVersions').count()).toBe(
    0,
  );
});

test('freezes rules and content, allows parallel unknown material review and requires controlled revision', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.saveRules();
  const original = f.content();
  let row = await f.draft(original);
  row = await f.fire(row, 'submit');
  expect(row.status).toBe('pending');
  expect(row.lines[0].identificationStatus).toBe('governing');
  expect(row.reviewTasks[0].candidates).toEqual([f.reviewer.user.id]);
  expect(
    row.versions[0].payload.parameterSnapshot.values.reviewerSelections[0]
      .referenceId,
  ).toBe(f.reviewer.user.id);
  expect(
    (
      await send(
        f.applicant.session,
        `/procurement/requests/${row.id}/approve`,
        mutation(row),
      )
    ).status,
  ).toBe(403);
  row = await f.fire(row, 'approve', f.reviewer.session);
  expect(row.approvedVersionId).toBe(row.submittedVersionId);
  const frozen = row.versions[0].payload;
  expect(
    (
      await send(
        f.applicant.session,
        `/procurement/requests/${row.id}`,
        { ...mutation(row), content: original },
        'PATCH',
      )
    ).status,
  ).toBe(400);
  row = await f.fire(row, 'revise');
  expect(row.approvedVersionId).toBeNull();
  expect(row.governanceEpoch).toBe(2);
  const edited = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}`,
    { ...mutation(row), content: { ...original, usage: 'Changed use' } },
    'PATCH',
  );
  expect(edited.status).toBe(200);
  row = (await edited.json()).data;
  expect(row.lines[0].id).toBe(original.lines[0].id);
  await f.saveRules(f.rules([f.agent.user.id], false), 1);
  row = await f.fire(row, 'submit');
  expect(row.reviewTasks[0].candidates).toEqual([f.reviewer.user.id]);
  expect(row.versions[1].payload).toEqual(frozen);
  expect(row.contentVersion).toBe(2);
});

test('withdraw and return close old tasks; resubmission reuses unchanged content and creates a new round', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.saveRules();
  let row = await f.fire(await f.draft(), 'submit');
  const oldVersion = row.submittedVersionId,
    stale = row;
  row = await f.fire(row, 'withdraw');
  expect(
    (
      await send(
        f.reviewer.session,
        `/procurement/requests/${row.id}/approve`,
        mutation(stale),
      )
    ).status,
  ).toBe(409);
  row = await f.fire(row, 'submit');
  expect(row.submittedVersionId).toBe(oldVersion);
  expect(row.versions).toHaveLength(1);
  expect(row.reviewRound).toBe(2);
  row = await f.fire(row, 'return', f.reviewer.session);
  expect(row.status).toBe('draft');
  expect(row.submittedVersionId).toBeNull();
  expect(row.reviewTasks.map((t: { status: string }) => t.status)).toEqual([
    'returned',
    'closed',
  ]);
});

test('keeps stable line identities through reorder and cancellation and rejects cross-parent or retired IDs', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database),
    content = f.content();
  content.lines.push(f.line());
  let row = await f.draft(content);
  const update = async (lines = content.lines) =>
    send(
      f.applicant.session,
      `/procurement/requests/${row.id}`,
      { ...mutation(row), content: { ...content, lines } },
      'PATCH',
    );
  row = (await (await update([...content.lines].reverse())).json()).data;
  expect(row.lines.map((l: { id: string }) => l.id)).toEqual(
    content.lines.map((l) => l.id).reverse(),
  );
  expect(
    row.lines.every((l: { inputRevision: number }) => l.inputRevision === 1),
  ).toBe(true);
  row = (await (await update([content.lines[0]])).json()).data;
  expect(
    row.lines.find((l: { id: string }) => l.id === content.lines[1].id).status,
  ).toBe('cancelled');
  expect((await update()).status).toBe(400);
  const second = await f.draft();
  expect(
    (await update([{ ...content.lines[0], id: second.lines[0].id }])).status,
  ).toBe(400);
  const current = (
    await (
      await f.applicant.session.fetch(`/procurement/requests/${row.id}`)
    ).json()
  ).data;
  expect(current.revision).toBe(row.revision);
});

test('rejects another company, another requester and another department', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database),
    own = await send(f.applicant.session, '/procurement/requests', {
      content: f.content(),
      requestKey: randomUUID(),
    });
  expect(own.status).toBe(201);

  const line = f.line(),
    lineB = {
      ...line,
      selection: { ...line.selection, subjectId: f.b.id },
    },
    foreignCompany = await send(f.applicant.session, '/procurement/requests', {
      content: {
        ...f.content(),
        subjectId: f.b.id,
        lines: [lineB],
      },
      requestKey: randomUUID(),
    });
  expect(foreignCompany.status).toBe(400);
  expect((await foreignCompany.json()).error.reason).toBe(
    'PURCHASE_COMPANY_UNAVAILABLE',
  );

  const foreignRequester = await send(
    f.applicant.session,
    '/procurement/requests',
    {
      content: {
        ...f.content(),
        requesterEmployeeId: f.reviewer.employee.id,
      },
      requestKey: randomUUID(),
    },
  );
  expect(foreignRequester.status).toBe(403);
  expect((await foreignRequester.json()).error.reason).toBe(
    'PURCHASE_FORBIDDEN',
  );

  const otherUnit = await f.create('/organization/units', {
      code: randomUUID(),
      name: 'Another department',
      type: 'department',
      subjectId: f.a.id,
    }),
    foreignUnit = await send(f.applicant.session, '/procurement/requests', {
      content: { ...f.content(), requestingUnitId: otherUnit.id },
      requestKey: randomUUID(),
    });
  expect(foreignUnit.status).toBe(400);
  expect((await foreignUnit.json()).error.reason).toBe(
    'PURCHASE_UNIT_UNAVAILABLE',
  );
});

test('validates complete configuration groups, scoped references, CAS and same-key replay', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database),
    key = randomUUID();
  const saved = await f.saveRules(f.rules(), 0, key);
  expect(await f.saveRules(f.rules(), 0, key)).toEqual(saved);
  const save = (body: unknown) =>
    send(f.admin, '/procurement/settings', body, 'PUT');
  expect(
    (
      await save({
        subjectId: f.a.id,
        version: 0,
        values: f.rules(),
        requestKey: randomUUID(),
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await save({
        subjectId: f.a.id,
        version: 1,
        values: f.rules([f.agent.user.id]),
        requestKey: key,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await save({
        subjectId: f.a.id,
        version: 1,
        values: { ...f.rules(), requireProject: true },
        requestKey: randomUUID(),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await save({
        subjectId: f.a.id,
        version: 1,
        values: { allowParallelGovernance: true },
        requestKey: randomUUID(),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await save({
        subjectId: f.b.id,
        version: 0,
        values: f.rules(),
        requestKey: randomUUID(),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await save({
        subjectId: f.a.id,
        version: 1,
        values: f.rules([]),
        requestKey: randomUUID(),
      })
    ).status,
  ).toBe(400);
});

test('deduplicates create, edit, submit and approval and rejects changed fingerprints and stale versions', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.saveRules();
  const body = { content: f.content(), requestKey: randomUUID() };
  let row = (
    await (
      await send(f.applicant.session, '/procurement/requests', body)
    ).json()
  ).data;
  expect(
    (
      await (
        await send(f.applicant.session, '/procurement/requests', body)
      ).json()
    ).data,
  ).toEqual(row);
  expect(
    (
      await send(f.applicant.session, '/procurement/requests', {
        ...body,
        content: { ...body.content, usage: 'different' },
      })
    ).status,
  ).toBe(409);
  const edit = {
    ...mutation(row),
    content: { ...body.content, notes: 'Edited' },
  };
  row = (
    await (
      await send(
        f.applicant.session,
        `/procurement/requests/${row.id}`,
        edit,
        'PATCH',
      )
    ).json()
  ).data;
  expect(
    (
      await (
        await send(
          f.applicant.session,
          `/procurement/requests/${row.id}`,
          edit,
          'PATCH',
        )
      ).json()
    ).data,
  ).toEqual(row);
  expect(
    (
      await send(
        f.applicant.session,
        `/procurement/requests/${row.id}`,
        { ...edit, requestKey: randomUUID() },
        'PATCH',
      )
    ).status,
  ).toBe(409);
  const submission = mutation(row);
  row = (
    await (
      await send(
        f.applicant.session,
        `/procurement/requests/${row.id}/submit`,
        submission,
      )
    ).json()
  ).data;
  expect(
    (
      await (
        await send(
          f.applicant.session,
          `/procurement/requests/${row.id}/submit`,
          submission,
        )
      ).json()
    ).data,
  ).toEqual(row);
  const approval = mutation(row);
  row = (
    await (
      await send(
        f.reviewer.session,
        `/procurement/requests/${row.id}/approve`,
        approval,
      )
    ).json()
  ).data;
  expect(
    (
      await (
        await send(
          f.reviewer.session,
          `/procurement/requests/${row.id}/approve`,
          approval,
        )
      ).json()
    ).data,
  ).toEqual(row);
  expect(
    await database
      .repository('supplyChainReviewTasks')
      .count({ filter: { requestId: row.id } }),
  ).toBe(1);
  expect(
    await database
      .repository('supplyChainAudit')
      .count({ filter: { recordId: row.id } }),
  ).toBe(4);
});

test('rolls back header, lines, audit and request replay when a later material resolution fails', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database),
    body = { content: f.content(), requestKey: randomUUID() };
  body.content.lines.push(f.line());
  const service = testApp.application.container.resolve(
      supplyChainMaterialServiceToken,
    ),
    original = service.resolveSelectionInTransaction.bind(service);
  let calls = 0;
  const spy = vi
    .spyOn(service, 'resolveSelectionInTransaction')
    .mockImplementation(async (...args) => {
      if (++calls === 2) throw new Error('Injected second line failure');
      return original(...args);
    });
  try {
    expect(
      (await send(f.applicant.session, '/procurement/requests', body)).status,
    ).toBe(500);
  } finally {
    spy.mockRestore();
  }
  expect(
    await database
      .repository('purchaseRequests')
      .count({ filter: { subjectId: f.a.id } }),
  ).toBe(0);
  expect(
    await database
      .repository('purchaseRequestLines')
      .count({ filter: { subjectId: f.a.id } }),
  ).toBe(0);
  expect(
    await database
      .repository('supplyChainActionRequests')
      .count({ filter: { requestKey: body.requestKey } }),
  ).toBe(0);
  expect(
    (await send(f.applicant.session, '/procurement/requests', body)).status,
  ).toBe(201);
});

test('rolls back rule snapshots, tasks, versions and lifecycle on failed submission, then retries the same key', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.saveRules();
  const row = await f.draft(),
    body = mutation(row);
  const parameters = testApp.application.container.resolve(
    purchaseRequestServiceToken,
  ).parameters;
  const snapshotCount = await database
    .repository('supplyChainParameterSnapshots')
    .count();
  const original = parameters.saveUsage.bind(parameters);
  const spy = vi
    .spyOn(parameters, 'saveUsage')
    .mockImplementation(async (...args) => {
      await original(...args);
      throw new Error('Injected usage failure');
    });
  try {
    expect(
      (
        await send(
          f.applicant.session,
          `/procurement/requests/${row.id}/submit`,
          body,
        )
      ).status,
    ).toBe(500);
  } finally {
    spy.mockRestore();
  }
  for (const table of ['supplyChainRequestVersions', 'supplyChainReviewTasks'])
    expect(
      await database.repository(table).count({ filter: { requestId: row.id } }),
    ).toBe(0);
  expect(
    await database.repository('supplyChainParameterSnapshots').count(),
  ).toBe(snapshotCount);
  expect(
    (await database
      .repository('purchaseRequests')
      .findOne({ filter: { id: row.id } }))!.status,
  ).toBe('draft');
  expect(
    await database
      .repository('supplyChainActionRequests')
      .count({ filter: { requestKey: body.requestKey } }),
  ).toBe(0);
  expect(
    (
      await send(
        f.applicant.session,
        `/procurement/requests/${row.id}/submit`,
        body,
      )
    ).status,
  ).toBe(200);
});

test('serializes competing decisions to one committed task outcome (SQLite, not a PostgreSQL concurrency claim)', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.saveRules();
  const row = await f.fire(await f.draft(), 'submit');
  const responses = await Promise.all(
    ['approve', 'return'].map((action) =>
      send(
        f.reviewer.session,
        `/procurement/requests/${row.id}/${action}`,
        mutation(row),
      ),
    ),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    await database
      .repository('supplyChainReviewTasks')
      .count({ filter: { requestId: row.id, status: 'pending' } }),
  ).toBe(0);
  expect(
    await database
      .repository('supplyChainAudit')
      .count({ filter: { recordId: row.id } }),
  ).toBe(3);
});

test('PostgreSQL: competing decisions overlap on distinct backend connections and commit one complete outcome', async ({
  testApp,
  database,
  skip,
}) => {
  if (database.connection().dialect !== 'postgres') skip();
  const f = await fixture(testApp, database);
  await f.saveRules();
  const row = await f.fire(await f.draft(), 'submit');
  const runtime = testApp.application.container.resolve(recordLifecycleToken);
  const lifecycleBefore = await runtime.history('purchaseRequests', row.id);
  const original = database.transaction.bind(database);
  const backends: number[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let gateTimedOut = false;
  const timeout = setTimeout(() => {
    gateTimedOut = true;
    release();
  }, 15000);
  const spy = vi
    .spyOn(database, 'transaction')
    .mockImplementation(
      async <T>(work: (c: DatabaseConnection) => Promise<T>, name?: string) =>
        original(async (c) => {
          // This PostgreSQL-only probe runs on the very connection handed to
          // the business transaction, before its organization lock is taken.
          const client = await c.client<{
            raw(sql: string): Promise<{ rows: { pid: number }[] }>;
          }>();
          const result = await client.raw('select pg_backend_pid() as pid');
          backends.push(result.rows[0].pid);
          if (backends.length === 2) release();
          await gate;
          return work(c);
        }, name),
    );
  const bodies = [mutation(row), mutation(row)];
  let responses: Response[];
  try {
    responses = await Promise.all(
      ['approve', 'return'].map((action, index) =>
        send(
          f.reviewer.session,
          `/procurement/requests/${row.id}/${action}`,
          bodies[index],
        ),
      ),
    );
  } finally {
    clearTimeout(timeout);
    release();
    spy.mockRestore();
  }
  expect(gateTimedOut).toBe(false);
  expect(backends).toHaveLength(2);
  expect(new Set(backends).size).toBe(2);
  console.info(
    JSON.stringify({
      probe: 'purchase-review-concurrency',
      backendPids: backends,
    }),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  const winner = responses.findIndex((r) => r.status === 200);
  const beforeRetry = (
    await (
      await f.applicant.session.fetch(`/procurement/requests/${row.id}`)
    ).json()
  ).data;
  expect(beforeRetry).toMatchObject({
    status: winner === 0 ? 'approved' : 'draft',
    revision: row.revision + 1,
    lifecycleVersion: row.lifecycleVersion + 1,
  });
  expect(beforeRetry.reviewTasks).toHaveLength(1);
  expect(beforeRetry.reviewTasks[0].status).toBe(
    winner === 0 ? 'approved' : 'returned',
  );
  expect(beforeRetry.versions).toHaveLength(1);
  expect(
    await database
      .repository('supplyChainAudit')
      .count({ filter: { recordId: row.id } }),
  ).toBe(3);
  const retry = await send(
    f.reviewer.session,
    `/procurement/requests/${row.id}/${winner === 0 ? 'approve' : 'return'}`,
    bodies[winner],
  );
  expect(retry.status).toBe(200);
  expect((await retry.json()).data).toEqual(beforeRetry);
  expect(
    await database
      .repository('supplyChainAudit')
      .count({ filter: { recordId: row.id } }),
  ).toBe(3);
  const history = await runtime.history('purchaseRequests', row.id);
  expect(history.transitions).toHaveLength(
    lifecycleBefore.transitions.length + 1,
  );
  expect(history.transitions.at(-1)!.transition).toBe(
    winner === 0 ? 'approve' : 'return',
  );
});

test('rolls back every purchase fact after the replay row is written, then retries the identical submit key', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.saveRules();
  const row = await f.draft();
  const body = mutation(row);
  const runtime = testApp.application.container.resolve(recordLifecycleToken);
  const tables = [
    'purchaseRequests',
    'purchaseRequestLines',
    'supplyChainRequestVersions',
    'supplyChainReviewTasks',
    'supplyChainParameterHeads',
    'supplyChainParameterVersions',
    'supplyChainParameterSelections',
    'supplyChainParameterRequests',
    'supplyChainParameterSnapshots',
    'supplyChainParameterUsages',
    'supplyChainAudit',
    'supplyChainActionRequests',
    'orgMutationLock',
    'supplyChainMutationLock',
    'materialMutationLock',
  ];
  const snapshot = async (c: DatabaseConnection) =>
    Object.fromEntries(
      await Promise.all(
        tables.map(async (table) => [
          table,
          (await c.repository(table).findMany({ limit: 10000 })).sort((a, b) =>
            String(a.id).localeCompare(String(b.id)),
          ),
        ]),
      ),
    );
  const before = await snapshot(database.connection());
  const lifecycleBefore = await runtime.history('purchaseRequests', row.id);
  const original = database.transaction.bind(database);
  let injected = false;
  const spy = vi
    .spyOn(database, 'transaction')
    .mockImplementation(
      async <T>(work: (c: DatabaseConnection) => Promise<T>, name?: string) =>
        original(async (c) => {
          const result = await work(c);
          if (
            await c
              .repository('supplyChainActionRequests')
              .exists({ filter: { requestKey: body.requestKey } })
          ) {
            injected = true;
            expect(
              await c
                .repository('supplyChainReviewTasks')
                .count({ filter: { requestId: row.id } }),
            ).toBe(1);
            expect(
              await c
                .repository('supplyChainRequestVersions')
                .count({ filter: { requestId: row.id } }),
            ).toBe(1);
            expect(
              await c.repository('supplyChainParameterUsages').count(),
            ).toBe(before.supplyChainParameterUsages.length + 1);
            expect(await c.repository('supplyChainAudit').count()).toBe(
              before.supplyChainAudit.length + 1,
            );
            throw new Error(
              'Injected failure after complete purchase replay persistence',
            );
          }
          return result;
        }, name),
    );
  try {
    expect(
      (
        await send(
          f.applicant.session,
          `/procurement/requests/${row.id}/submit`,
          body,
        )
      ).status,
    ).toBe(500);
  } finally {
    spy.mockRestore();
  }
  expect(injected).toBe(true);
  expect(await snapshot(database.connection())).toEqual(before);
  expect(await runtime.history('purchaseRequests', row.id)).toEqual(
    lifecycleBefore,
  );
  const retry = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}/submit`,
    body,
  );
  expect(retry.status).toBe(200);
  expect((await retry.json()).data.status).toBe('pending');
  expect(
    await database
      .repository('supplyChainActionRequests')
      .count({ filter: { requestKey: body.requestKey } }),
  ).toBe(1);
  expect(
    (await runtime.history('purchaseRequests', row.id)).transitions,
  ).toHaveLength(lifecycleBefore.transitions.length + 1);
});

test('protects reviewer independence even if applicant or creator also holds review permission', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.grant(f.applicant.user.id, ['review']);
  await f.saveRules(f.rules([f.applicant.user.id, f.reviewer.user.id]));
  const row = await f.fire(await f.draft(), 'submit');
  expect(row.reviewTasks[0].candidates).toEqual([f.reviewer.user.id]);
  const r = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}/approve`,
    mutation(row),
  );
  expect(r.status).toBe(403);
  const next = await f.fire(row, 'return', f.reviewer.session);
  await f.users.disable(f.reviewer.user.id);
  expect(
    (
      await send(
        f.applicant.session,
        `/procurement/requests/${next.id}/submit`,
        mutation(next),
      )
    ).status,
  ).toBe(400);
});

test('cancels and copies into a linked draft with fresh line IDs and new rules', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.saveRules();
  let row = await f.fire(await f.draft(), 'submit');
  row = await f.fire(row, 'cancel');
  await f.saveRules(f.rules([f.agent.user.id]), 1);
  const body = { ...mutation(row), content: f.content() };
  const response = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}/copy`,
    body,
  );
  expect(response.status).toBe(201);
  let copy = (await response.json()).data;
  expect(copy.supersedesId).toBe(row.id);
  expect(copy.lines[0].id).not.toBe(body.content.lines[0].id);
  copy = await f.fire(copy, 'submit');
  expect(copy.reviewTasks[0].candidates).toEqual([f.agent.user.id]);
  expect(
    (await f.applicant.session.fetch(`/procurement/requests/${row.id}`)).status,
  ).toBe(200);
});

test('paginates scoped searches, exposes minimal options, documents APIs and preserves seed customization', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  for (let i = 0; i < 3; i++) await f.draft();
  const response = await f.applicant.session.fetch(
    `/procurement/requests?subjectId=${f.a.id}&q=Maintenance&page=2&pageSize=2&neededFrom=2020-01-01&neededTo=2099-01-01&identification=unidentified`,
  );
  const page = await response.json();
  expect(page.error).toBeUndefined();
  expect({ status: response.status, error: page.error }).toMatchObject({
    status: 200,
  });
  expect(page.meta.total).toBe(3);
  expect(page.data).toHaveLength(1);
  const options = await (
    await f.applicant.session.fetch(
      `/procurement/requestOptions?subjectId=${f.a.id}&kind=employees`,
    )
  ).json();
  expect(options.error).toBeUndefined();
  expect(options.data).toEqual([
    {
      id: f.applicant.employee.id,
      code: f.applicant.employee.code,
      name: 'Applicant',
    },
  ]);
  expect(findUndeclaredApiRoutes(testApp.application)).toEqual([]);
  const doc = await testApp.application.container
    .resolve(apiDocsToken)
    .getDocument();
  expect(findApiDocumentSchemaProblems(doc)).toEqual([]);
  expect(doc.paths?.['/api/procurement/requests']?.post?.operationId).toBe(
    'createPurchaseRequest',
  );
  expect(doc.paths?.['/api/purchaseRequests/createOne']).toBeUndefined();
  const role = await database
    .repository('authorizationPermissionSets')
    .findOne({ filter: { key: 'procurement-requester' } });
  await database.repository('authorizationPermissionSets').updateOne({
    filter: { id: String(role!.id) },
    values: { title: encodeAuthorizationTitle('Custom title') },
  });
  await defaults.run({
    repository: (name) => database.repository(name),
  } as Parameters<typeof defaults.run>[0]);
  expect(
    (await database
      .repository('authorizationPermissionSets')
      .findOne({ filter: { id: String(role!.id) } }))!.title,
  ).toBe(encodeAuthorizationTitle('Custom title'));
  expect(
    await database.repository('authorizationPermissionSetAssignments').count({
      filter: { permissionSetKey: 'procurement-review-configurator' },
    }),
  ).toBe(0);
});

test('uses frozen position selectors, keeps existing candidates fixed and recovers when all candidates lose qualification', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  const values = {
    reviewerSelections: [
      { group: 1, type: 'position', referenceId: f.position.id },
    ],
    allowParallelGovernance: true,
    requireProject: false,
  };
  const saved = await send(
    f.admin,
    '/procurement/settings',
    { subjectId: f.a.id, version: 0, requestKey: randomUUID(), values },
    'PUT',
  );
  expect(saved.status).toBe(200);
  let row = await f.fire(await f.draft(), 'submit');
  expect(row.reviewTasks[0].candidates.sort()).toEqual(
    [f.reviewer.user.id, f.agent.user.id].sort(),
  );
  const newcomer = await f.person('New reviewer');
  await f.grant(newcomer.user.id, ['read', 'review']);
  expect(
    (
      await send(
        newcomer.session,
        `/procurement/requests/${row.id}/approve`,
        mutation(row),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await send(
        f.admin,
        `/procurement/requests/${row.id}/reassign`,
        mutation(row),
      )
    ).status,
  ).toBe(400);
  await f.users.disable(f.reviewer.user.id);
  await f.users.disable(f.agent.user.id);
  row = await f.fire(row, 'reassign', f.admin);
  expect(row.reviewTasks[0].candidates).toEqual([newcomer.user.id]);
  expect(row.reviewTasks[1].status).toBe('reassigned');
  expect(row.submittedVersionId).toBe(row.versions[0].id);
  row = await f.fire(row, 'approve', newcomer.session);
  expect(row.status).toBe('approved');
});

test('intersects same-group reviewer choices, unions separate groups, and filters self and inactive accounts', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  const values = {
    reviewerSelections: [
      { group: 1, type: 'position', referenceId: f.position.id },
      { group: 1, type: 'user', referenceId: f.reviewer.user.id },
      { group: 2, type: 'user', referenceId: f.agent.user.id },
      { group: 3, type: 'user', referenceId: f.applicant.user.id },
    ],
    allowParallelGovernance: true,
    requireProject: false,
  };
  expect(
    (
      await send(
        f.admin,
        '/procurement/settings',
        { subjectId: f.a.id, version: 0, values, requestKey: randomUUID() },
        'PUT',
      )
    ).status,
  ).toBe(200);
  await f.users.disable(f.agent.user.id);
  const row = await f.fire(await f.draft(), 'submit');
  expect(row.reviewTasks[0].candidates).toEqual([f.reviewer.user.id]);
});

test('requires full identification when parallel governance is disabled; configuration editors have separate company scope', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.saveRules(f.rules(undefined, false));
  const row = await f.draft();
  const response = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}/submit`,
    mutation(row),
  );
  expect((await response.json()).error.reason).toBe(
    'PURCHASE_MATERIALS_REQUIRED',
  );
  await f.authz.permissionSets.assign({
    permissionSet: 'procurement-review-configurator',
    subject: { type: 'user', id: f.agent.user.id },
  });
  const settings = await f.agent.session.fetch(
    `/procurement/settings?subjectId=${f.a.id}`,
  );
  expect(settings.status).toBe(200);
  expect((await settings.json()).data.fields).toEqual([
    { key: 'reviewerSelections', type: 'reviewers', title: expect.any(String) },
    {
      key: 'allowParallelGovernance',
      type: 'boolean',
      title: expect.any(String),
    },
  ]);
  expect(
    (await f.agent.session.fetch(`/procurement/settings?subjectId=${f.b.id}`))
      .status,
  ).toBe(400);
  const choices = await (
    await f.agent.session.fetch(
      `/procurement/settings/options?subjectId=${f.a.id}&kind=reviewers`,
    )
  ).json();
  expect(choices.data).toHaveLength(3);
  expect(
    choices.data.every(
      (r: Record<string, unknown>) =>
        Object.keys(r).sort().join(',') === 'code,id,name',
    ),
  ).toBe(true);
  const companies = await (
    await f.agent.session.fetch('/procurement/settings/companies')
  ).json();
  expect(companies.data.map((c: { id: string }) => c.id)).toEqual([f.a.id]);
  expect(
    (await f.agent.session.fetch(`/procurement/requests?subjectId=${f.a.id}`))
      .status,
  ).toBe(403);
});

test('does not let broad request grants cross into another company', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.grant(f.agent.user.id, ['read', 'create'], [f.a.id, f.b.id]);
  const line = f.line(),
    content: PurchaseContent = {
      ...f.content(),
      subjectId: f.b.id,
      requesterEmployeeId: f.agent.employee.id,
      requestingUnitId: null,
      lines: [{ ...line, selection: { ...line.selection, subjectId: f.b.id } }],
    };
  const response = await send(f.agent.session, '/procurement/requests', {
    content,
    requestKey: randomUUID(),
  });
  expect(response.status).toBe(400);
  expect((await response.json()).error.reason).toBe(
    'PURCHASE_POSITION_REQUIRED',
  );
});

test('rechecks supplier qualification and company notes preserve frozen historical identity', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.saveRules();
  const supplier = await f.create('/procurement/suppliers', {
    subjectId: f.a.id,
    code: randomUUID(),
    name: 'Optional supplier',
    notes: '',
    requestKey: randomUUID(),
  });
  const row = await f.draft({
    ...f.content(),
    suggestedSupplierId: supplier.partnerId,
  });
  expect(row.supplierSnapshot.identity.name).toBe('Optional supplier');
  const disabled = await send(
    f.admin,
    `/procurement/suppliers/${supplier.id}/deactivate`,
    {
      version: supplier.revision,
      requestKey: randomUUID(),
      reason: 'Supplier no longer available',
    },
  );
  expect(disabled.status).toBe(200);
  const response = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}/submit`,
    mutation(row),
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error.reason).toBe(
    'SUPPLIER_COMPANY_INACTIVE',
  );
  const current = (
    await (
      await f.applicant.session.fetch(`/procurement/requests/${row.id}`)
    ).json()
  ).data;
  expect(current.supplierSnapshot).toEqual(row.supplierSnapshot);
  expect(current.status).toBe('draft');
});

test('enforces write fields and post-create scope around lifecycle persistence, including replay read restrictions', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database),
    service = testApp.application.container.resolve(
      purchaseRequestServiceToken,
    );
  const allow = {
    read: true,
    create: true,
    update: true,
    delete: false,
  } as const;
  const p: MaterialPolicies = Object.fromEntries(
    Object.keys(purchaseReadColumns).map((table) => [table, allow]),
  );
  const body = { content: f.content(), requestKey: randomUUID() };
  const actor = { id: f.applicant.user.id };
  await expect(
    service.create(body, actor, {
      policies: {
        ...p,
        purchaseRequests: {
          ...allow,
          create: { scope: { subjectId: f.b.id } },
        },
      },
    }),
  ).rejects.toMatchObject({ reason: 'PURCHASE_FORBIDDEN' });
  const row = await service.create(body, actor, {
    policies: p,
  });
  await expect(
    service.create(body, actor, {
      policies: {
        ...p,
        purchaseRequests: {
          ...allow,
          read: {
            scope: true,
            fields: ['id', 'subjectId', 'requesterEmployeeId', 'createdBy'],
          },
        },
      },
    }),
  ).rejects.toMatchObject({ reason: 'PURCHASE_FORBIDDEN' });
  await expect(
    service.create(body, actor, {
      policies: { ...p, purchaseRequestLines: { ...allow, create: false } },
    }),
  ).rejects.toMatchObject({ reason: 'PURCHASE_FORBIDDEN' });
  const edit = {
    version: Number(row.revision),
    lifecycleVersion: Number(row.lifecycleVersion),
    requestKey: randomUUID(),
    reason: 'Field restriction',
    content: { ...f.content(), lines: [], notes: 'Changed' },
  };
  await expect(
    service.update(String(row.id), edit, actor, {
      policies: {
        ...p,
        purchaseRequests: {
          ...allow,
          update: { scope: true, fields: ['notes', 'updatedBy'] },
        },
      },
    }),
  ).rejects.toMatchObject({ reason: 'PURCHASE_FORBIDDEN' });
  expect((await service.detail(String(row.id), p)).revision).toBe(row.revision);
});

test('requires matching parent company, positive quantities and valid references at the database boundary', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database),
    row = await f.draft();
  const line = await database
    .repository('purchaseRequestLines')
    .findOne({ filter: { id: row.lines[0].id } });
  await expect(
    database.repository('purchaseRequestLines').createOne({
      values: { ...line, id: randomUUID(), subjectId: f.b.id, lineNo: 20 },
    }),
  ).rejects.toBeTruthy();
  await expect(
    database.repository('purchaseRequestLines').createOne({
      values: {
        ...line,
        id: randomUUID(),
        requestedQuantity: '0',
        lineNo: 21,
      },
    }),
  ).rejects.toBeTruthy();
  await expect(
    database.repository('purchaseRequestLines').createOne({
      values: { ...line, id: randomUUID(), skuId: randomUUID(), lineNo: 22 },
    }),
  ).rejects.toBeTruthy();
  await expect(
    database.repository('purchaseRequestLines').createOne({
      values: { ...line, id: randomUUID() },
    }),
  ).rejects.toBeTruthy();
  for (const values of [
    { revision: 0 },
    { contentVersion: 0 },
    { governanceEpoch: 0 },
    { reviewRound: -1 },
    { lifecycleVersion: -1 },
    { identifiedCount: 2 },
    { lineCount: 101 },
  ])
    await expect(
      database.repository('purchaseRequests').updateOne({
        filter: { id: row.id },
        values,
      }),
    ).rejects.toBeTruthy();
  const response = await send(f.applicant.session, '/procurement/requests', {
    content: { ...f.content(), projectId: randomUUID() },
    requestKey: randomUUID(),
  });
  expect(response.status).toBe(400);
});

test('stores known SKU and exact packaging quantities and revalidates company admission before submission', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.saveRules();
  await f.authz.permissionSets.assign({
    permissionSet: 'materials-reviewer',
    subject: { type: 'user', id: f.reviewer.user.id },
  });
  const activate = async (
    kind: string,
    record: { id: string; lifecycleVersion: number },
  ) => {
    let row = record;
    for (const transition of ['submit', 'approve']) {
      const r = await send(
        transition === 'submit' ? f.admin : f.reviewer.session,
        `/materials/${kind}/${row.id}/${transition}`,
        {
          version: row.lifecycleVersion,
          requestKey: randomUUID(),
          reason: 'Isolated material qualification',
        },
      );
      const v = await r.json();
      expect(v.error).toBeUndefined();
      row = v.data;
    }
    return row;
  };
  const template = await f.create('/materials/templates', {
    name: 'Purchase specification',
    fields: [
      {
        key: 'model',
        title: 'Model',
        type: 'text',
        identity: true,
        required: true,
      },
    ],
  });
  const name = await f.create('/materials/names', {
    name: 'Purchase gloves',
    templateId: template.id,
  });
  const each = await database
      .repository('measureUnits')
      .findOne({ filter: { code: 'EA' } }),
    box = await database
      .repository('measureUnits')
      .findOne({ filter: { code: 'BOX' } });
  const sku = await activate(
    'skus',
    await f.create('/materials/skus', {
      name: 'Gloves model A',
      materialNameId: name.id,
      baseUnitId: String(each!.id),
      managementMode: 'stock',
      attributeValues: { model: 'A' },
    }),
  );
  const setting = await f.create('/materials/subjectSettings', {
    name: 'Purchase admission',
    subjectId: f.a.id,
    skuId: sku.id,
    canPurchase: true,
    canSell: false,
  });
  const pack = await activate(
    'unitRules',
    await f.create('/materials/unitRules', {
      name: 'Twelve each per box',
      skuId: sku.id,
      unitId: String(box!.id),
      numerator: '12',
      denominator: '1',
    }),
  );
  const known = {
    ...f.line(),
    selection: {
      kind: 'known' as const,
      subjectId: f.a.id,
      skuId: sku.id,
      unitId: String(box!.id),
      unitRuleId: pack.id,
      quantity: '2',
    },
  };
  const content = { ...f.content(), lines: [known] };
  const offered = await f.applicant.session.fetch(
    `/procurement/requestMaterialOptions?subjectId=${f.a.id}`,
  );
  expect(offered.status).toBe(200);
  expect(
    (await offered.json()).data.map((r: { id: string }) => r.id),
  ).toContain(sku.id);
  const option = await (
    await f.applicant.session.fetch(
      `/procurement/requestMaterialOptions/${sku.id}?subjectId=${f.a.id}`,
    )
  ).json();
  expect(option.data.packages[0]).toMatchObject({
    id: pack.id,
    unitName: box!.name,
  });
  const preview = await send(
    f.applicant.session,
    '/procurement/requestMaterialSelections',
    known.selection,
  );
  expect(preview.status).toBe(200);
  expect((await preview.json()).data.baseQuantity).toBe('24');
  expect(
    (
      await f.applicant.session.fetch(
        `/procurement/materialOptions?subjectId=${f.a.id}`,
      )
    ).status,
  ).toBe(403);
  const row = await f.draft(content);
  expect(row.lines[0].baseQuantity).toBe('24');
  expect(row.lines[0].numeratorSnapshot).toBe('12');
  expect(row.lines[0].unitRuleId).toBe(pack.id);
  expect(row.identificationStatus).toBe('identified');
  const pending = await f.fire(row, 'submit');
  const approved = await f.fire(pending, 'approve', f.reviewer.session);
  expect(approved.versions[0].payload.lines[0].baseQuantity).toBe('24');
  const other = await f.draft({
    ...content,
    lines: [{ ...known, id: randomUUID() }],
  });
  const disabled = await send(
    f.admin,
    `/materials/subjectSettings/${setting.id}/deactivate`,
    {
      version: setting.lifecycleVersion,
      requestKey: randomUUID(),
      reason: 'End company admission',
    },
  );
  expect(disabled.status).toBe(200);
  const response = await send(
    f.applicant.session,
    `/procurement/requests/${other.id}/submit`,
    mutation(other),
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error.reason).toBe(
    'SUPPLY_MATERIAL_UNAVAILABLE',
  );
  expect(
    (await database
      .repository('purchaseRequests')
      .findOne({ filter: { id: other.id } }))!.status,
  ).toBe('draft');
});

test('projects scoped names and action capabilities without writing locks, lifecycle parameters, tasks or history', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.saveRules();
  const supplier = await f.create('/procurement/suppliers', {
    subjectId: f.a.id,
    code: randomUUID(),
    name: 'Qualified supplier',
    requestKey: randomUUID(),
  });
  const row = await f.draft({
    ...f.content(),
    suggestedSupplierId: supplier.partnerId,
  });
  const before = await Promise.all(
    [
      'orgMutationLock',
      'supplyChainMutationLock',
      'materialMutationLock',
      'supplyChainParameterSnapshots',
      'supplyChainParameterUsages',
      'supplyChainReviewTasks',
      'supplyChainAudit',
      'supplyChainActionRequests',
    ].map((table) => database.repository(table).findMany({ limit: 10000 })),
  );
  const response = await f.applicant.session.fetch(
    `/procurement/requests/${row.id}/capabilities`,
  );
  const data = await response.json();
  expect({ status: response.status, error: data.error }).toMatchObject({
    status: 200,
  });
  expect(data.data.actions.submit).toMatchObject({
    visible: true,
    enabled: true,
  });
  expect(data.data.actions.approve).toMatchObject({
    visible: false,
    enabled: false,
  });
  const after = await Promise.all(
    [
      'orgMutationLock',
      'supplyChainMutationLock',
      'materialMutationLock',
      'supplyChainParameterSnapshots',
      'supplyChainParameterUsages',
      'supplyChainReviewTasks',
      'supplyChainAudit',
      'supplyChainActionRequests',
    ].map((table) => database.repository(table).findMany({ limit: 10000 })),
  );
  expect(after).toEqual(before);
  const list = await (
    await f.applicant.session.fetch(`/procurement/requests?subjectId=${f.a.id}`)
  ).json();
  expect(list.data[0].display.requester.name).toBe('Applicant');
  expect(list.data[0].display.company.id).toBe(f.a.id);
  const pending = await f.fire(row, 'submit');
  const review = await (
    await f.reviewer.session.fetch(
      `/procurement/requests/${pending.id}/capabilities`,
    )
  ).json();
  expect(review.data.actions.approve.enabled).toBe(true);
  expect(review.data.actions.submit.visible).toBe(false);
  await f.grant(f.applicant.user.id, ['review']);
  const self = await (
    await f.applicant.session.fetch(
      `/procurement/requests/${pending.id}/capabilities`,
    )
  ).json();
  expect(self.data.actions.approve).toMatchObject({
    visible: true,
    enabled: false,
    reason: 'PURCHASE_REVIEW_DENIED',
  });
});

test('serves request-owned supplier options without maintenance grants and filters departments by authorized effective requester', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  const supplier = await f.create('/procurement/suppliers', {
    subjectId: f.a.id,
    code: randomUUID(),
    name: 'Request-only supplier',
    requestKey: randomUUID(),
  });
  const available = await f.applicant.session.fetch(
    `/procurement/requestSupplierOptions?subjectId=${f.a.id}`,
  );
  expect(available.status).toBe(200);
  expect((await available.json()).data).toContainEqual({
    id: supplier.partnerId,
    code: supplier.identity.code,
    name: 'Request-only supplier',
  });
  expect(
    (
      await f.applicant.session.fetch(
        `/procurement/supplierOptions?subjectId=${f.a.id}`,
      )
    ).status,
  ).toBe(403);
  const otherUnit = await f.create('/organization/units', {
    subjectId: f.a.id,
    type: 'department',
    code: randomUUID(),
    name: 'No effective requester assignment',
  });
  const units = await (
    await f.applicant.session.fetch(
      `/procurement/requestOptions?subjectId=${f.a.id}&kind=units&requesterEmployeeId=${f.applicant.employee.id}`,
    )
  ).json();
  expect(units.data.map((r: { id: string }) => r.id)).toContain(f.unit.id);
  expect(units.data.map((r: { id: string }) => r.id)).not.toContain(
    otherUnit.id,
  );
  expect(
    (
      await f.applicant.session.fetch(
        `/procurement/requestOptions?subjectId=${f.a.id}&kind=units&requesterEmployeeId=${f.reviewer.employee.id}`,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await f.applicant.session.fetch(
        `/procurement/requestSupplierOptions?subjectId=${f.b.id}`,
      )
    ).status,
  ).toBe(400);
});

test('retains saved off-page and inactive reviewer references with explicit availability', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.saveRules();
  await database.repository('personnelEmployees').updateOne({
    filter: { id: f.reviewer.employee.id },
    values: { status: 'inactive' },
  });
  const current = await (
    await f.admin.fetch(`/procurement/settings?subjectId=${f.a.id}`)
  ).json();
  expect(current.data.references).toContainEqual(
    expect.objectContaining({
      type: 'user',
      referenceId: f.reviewer.user.id,
      name: 'Reviewer',
      availability: 'inactive',
    }),
  );
  const options = await (
    await f.admin.fetch(
      `/procurement/settings/options?subjectId=${f.a.id}&kind=reviewers`,
    )
  ).json();
  expect(options.data.map((r: { id: string }) => r.id)).not.toContain(
    f.reviewer.user.id,
  );
  expect(current.data.values.reviewerSelections[0].referenceId).toBe(
    f.reviewer.user.id,
  );
});

test('keeps the entered copy reason in the new request audit and exposes only authorized direct relations', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  let row = await f.draft();
  row = await f.fire(row, 'cancel');
  const values = {
    ...mutation(row),
    content: f.content(),
    reason: 'Replace cancelled demand with corrected needs',
  };
  const response = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}/copy`,
    values,
  );
  expect(response.status).toBe(201);
  const copy = (await response.json()).data;
  expect(copy.recentHistory[0]).toMatchObject({
    operation: 'copy',
    reason: values.reason,
  });
  const history = await (
    await f.applicant.session.fetch(`/procurement/requests/${copy.id}/history`)
  ).json();
  expect(history.data[0].reason).toBe(values.reason);
  const source = await (
    await f.applicant.session.fetch(`/procurement/requests/${row.id}`)
  ).json();
  expect(source.data.display.relatedRequests).toContainEqual({
    id: copy.id,
    code: copy.code,
    relation: 'copy',
  });
  expect(copy.display.relatedRequests).toContainEqual({
    id: row.id,
    code: row.code,
    relation: 'source',
  });
  expect(
    (
      await (
        await send(
          f.applicant.session,
          `/procurement/requests/${row.id}/copy`,
          values,
        )
      ).json()
    ).data.id,
  ).toBe(copy.id);
});

test('adds missing page grants once and preserves administrator titles, scopes and explicit empty page grants', async ({
  database,
}) => {
  const repo = database.repository('authorizationPermissionSets'),
    role = await repo.findOne({ filter: { key: 'procurement-requester' } });
  const grants = (
    typeof role!.grants === 'string'
      ? JSON.parse(role!.grants)
      : structuredClone(role!.grants)
  ) as { resource: { type: string; id: string }; actions: unknown[] }[];
  const withoutPage = grants.filter((g) => g.resource.type !== 'page');
  await repo.updateOne({
    filter: { id: String(role!.id) },
    values: { title: 'Administrator customized title', grants: withoutPage },
  });
  const run = () =>
    database.transaction((c) =>
      pageDefaults.run({ repository: (table) => c.repository(table) }),
    );
  await run();
  let current = await repo.findOne({ filter: { id: String(role!.id) } });
  expect(current!.title).toBe('Administrator customized title');
  expect(current!.grants).toEqual([
    ...withoutPage,
    {
      resource: { type: 'page', id: 'procurement-requests' },
      actions: [{ action: 'access' }],
    },
  ]);
  await run();
  expect(
    (await repo.findOne({ filter: { id: String(role!.id) } }))!.grants,
  ).toEqual(current!.grants);
  const explicit = [
    ...withoutPage,
    { resource: { type: 'page', id: 'procurement-requests' }, actions: [] },
  ];
  await repo.updateOne({
    filter: { id: String(role!.id) },
    values: { grants: explicit },
  });
  await run();
  current = await repo.findOne({ filter: { id: String(role!.id) } });
  expect(current!.grants).toEqual(explicit);
});

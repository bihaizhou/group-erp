// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import { createStandaloneServer } from '../../server/standalone.js';
import {
  fixture,
  send,
  mutation,
  purchaseMaterial,
} from '../helpers/purchase-requests.js';
import { issueRequestServiceToken } from '../../server/providers/requisitions.js';
import type { DatabaseConnection } from '@nocobase/db';
import { recordLifecycleToken } from '../../server/providers/record-lifecycle.js';

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
const setup = async (...args: Parameters<typeof fixture>) => {
  const f = await fixture(...args);
  for (const [user, permissionSet] of [
    [f.applicant.user.id, 'requisitions-requester'],
    [f.applicant.user.id, 'requisitions-source-requester'],
    [f.reviewer.user.id, 'requisitions-request-reviewer'],
  ] as const)
    await f.authz.permissionSets.assign({
      permissionSet,
      subject: { type: 'user', id: user },
    });
  const purposeResponse = await send(f.admin, '/requisitions/purposes', {
    content: {
      subjectId: f.a.id,
      code: 'REPAIR',
      name: '设备维修',
      description: 'Isolated issue verification',
    },
    requestKey: randomUUID(),
  });
  const purposeBody = await purposeResponse.json();
  expect(purposeResponse.status).toBe(201);
  const purpose = purposeBody.data;
  const content = () => {
    const { suggestedSupplierId: _supplier, ...base } = f.content();
    return {
      ...base,
      recipientEmployeeId: f.applicant.employee.id,
      purposeId: purpose.id,
    };
  };
  const draft = async (value = content(), session = f.applicant.session) => {
    const response = await send(session, '/requisitions/requests', {
      content: value,
      requestKey: randomUUID(),
    });
    const body = await response.json();
    expect(response.status).toBe(201);
    return body.data;
  };
  const fire = async (
    row: Parameters<typeof mutation>[0] & { id: string },
    transition: string,
    session = f.applicant.session,
  ) => {
    const response = await send(
      session,
      `/requisitions/requests/${row.id}/${transition}`,
      mutation(row),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    return body.data;
  };
  const rules = async () => {
    const response = await send(
      f.admin,
      '/requisitions/settings',
      {
        subjectId: f.a.id,
        version: 0,
        requestKey: randomUUID(),
        values: f.rules(),
      },
      'PUT',
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    return body.data;
  };
  return { ...f, purpose, content, draft, fire, rules };
};

test('authenticates issue routes and independently denies ungranted purpose/request/settings actions', async ({
  testApp,
  request,
  database,
}) => {
  for (const path of [
    '/requisitions/requests',
    '/requisitions/purposes',
    '/requisitions/settings',
    '/requisitions/requestPurposeOptions',
    '/requisitions/purposes/not-id',
  ])
    expect((await request(path)).status).toBe(401);
  const f = await setup(testApp, database);
  expect(
    (await send(f.applicant.session, '/requisitions/purposes', {})).status,
  ).toBe(403);
  expect(
    (await send(f.applicant.session, '/requisitions/settings', {}, 'PUT'))
      .status,
  ).toBe(403);
  expect(
    (
      await send(
        f.applicant.session,
        '/requisitions/requests/not-id/approve',
        {},
      )
    ).status,
  ).toBe(403);
});
test('persists distinct issue identities and frozen review snapshots without a purchase parent', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  await f.rules();
  let row = await f.draft();
  expect(row.code).toMatch(/^IR-/u);
  expect(row.recipientEmployeeId).toBe(f.applicant.employee.id);
  expect(row.purposeSnapshot.name).toBe('设备维修');
  expect(row.lines[0].requestedQuantity).toBe('20');
  row = await f.fire(row, 'submit');
  expect(row.status).toBe('pending');
  expect(row.versions).toHaveLength(1);
  expect(row.versions[0].issueRequestId).toBe(row.id);
  expect(row.reviewTasks[0].issueRequestId).toBe(row.id);
  expect(row.reviewTasks[0].excludedActors).toContain(f.applicant.user.id);
  row = await f.fire(row, 'approve', f.reviewer.session);
  expect(row.status).toBe('approved');
  expect(row.approvedVersionId).toBe(row.submittedVersionId);
  expect(await database.repository('purchaseRequests').count()).toBe(0);
  expect(await database.repository('supplyChainRequestVersions').count()).toBe(
    1,
  );
  const detail = await f.applicant.session.fetch(
    `/requisitions/requests/${row.id}`,
  );
  expect((await detail.json()).data).toMatchObject({
    recipientEmployeeId: f.applicant.employee.id,
    purposeId: f.purpose.id,
    status: 'approved',
  });
});
test('allows incomplete drafts but requires an active own-company recipient and purpose on submission', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  await f.rules();
  const row = await f.draft({
    ...f.content(),
    recipientEmployeeId: null,
    purposeId: null,
  } as never);
  const response = await send(
    f.applicant.session,
    `/requisitions/requests/${row.id}/submit`,
    mutation(row),
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error.reason).toBe('ISSUE_REQUIRED');
  const other = await send(f.applicant.session, '/requisitions/requests', {
    content: { ...f.content(), recipientEmployeeId: f.reviewer.employee.id },
    requestKey: randomUUID(),
  });
  expect(other.status).toBe(403);
  expect((await other.json()).error.reason).toBe(
    'ISSUE_RECIPIENT_DELEGATE_REQUIRED',
  );
  const cross = await send(f.applicant.session, '/requisitions/requests', {
    content: { ...f.content(), subjectId: f.b.id, lines: [] },
    requestKey: randomUUID(),
  });
  expect(cross.status).toBeGreaterThanOrEqual(400);
  expect(
    await database
      .repository('materialIssueRequests')
      .count({ filter: { subjectId: f.a.id } }),
  ).toBe(1);
});
test('freezes a real purpose, rejects new references after deactivation, and preserves approved history', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  await f.rules();
  let row = await f.draft();
  row = await f.fire(row, 'submit');
  row = await f.fire(row, 'approve', f.reviewer.session);
  const stopped = await send(
    f.admin,
    `/requisitions/purposes/${f.purpose.id}/deactivate`,
    mutation(f.purpose),
  );
  expect(stopped.status).toBe(200);
  const failed = await send(f.applicant.session, '/requisitions/requests', {
    content: f.content(),
    requestKey: randomUUID(),
  });
  expect(failed.status).toBe(400);
  expect((await failed.json()).error.reason).toBe('ISSUE_PURPOSE_UNAVAILABLE');
  const detail = (
    await (
      await f.applicant.session.fetch(`/requisitions/requests/${row.id}`)
    ).json()
  ).data;
  expect(detail.purposeSnapshot.name).toBe('设备维修');
  expect(detail.versions[0].payload.head.purposeSnapshot.name).toBe('设备维修');
});
test('uses exact stock selection quantities independent of purchasing and selling flags', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database),
    m = await purchaseMaterial(f as never, database);
  await database.repository('materialSubjectSettings').updateOne({
    filter: { id: m.admission.id },
    values: { canPurchase: false, canSell: false },
  });
  const row = await f.draft({ ...f.content(), lines: m.content.lines });
  expect(row.lines[0].baseQuantity).toBe('24');
  expect(row.lines[0].managementModeSnapshot).toBe('stock');
});
test('protects issue edits with versions and replays the same create without duplicate lines or audit', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database),
    input = { content: f.content(), requestKey: randomUUID() };
  const first = await send(
      f.applicant.session,
      '/requisitions/requests',
      input,
    ),
    row = (await first.json()).data;
  expect(first.status).toBe(201);
  const retry = await send(
    f.applicant.session,
    '/requisitions/requests',
    input,
  );
  expect(retry.status).toBe(201);
  expect((await retry.json()).data.id).toBe(row.id);
  const edit = {
    ...mutation(row),
    content: { ...input.content, notes: 'changed' },
  };
  expect(
    (
      await send(
        f.applicant.session,
        `/requisitions/requests/${row.id}`,
        edit,
        'PATCH',
      )
    ).status,
  ).toBe(200);
  const stale = await send(
    f.applicant.session,
    `/requisitions/requests/${row.id}`,
    { ...edit, requestKey: randomUUID() },
    'PATCH',
  );
  expect(stale.status).toBe(409);
  expect(
    await database
      .repository('materialIssueRequests')
      .count({ filter: { subjectId: f.a.id } }),
  ).toBe(1);
  expect(
    await database
      .repository('materialIssueRequestLines')
      .count({ filter: { subjectId: f.a.id } }),
  ).toBe(1);
});

test('rejects a recipient as the only reviewer even when an authorized agent submits the request', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  await f.authz.permissionSets.assign({
    permissionSet: 'requisitions-request-agent',
    subject: { type: 'user', id: f.agent.user.id },
  });
  await f.authz.permissionSets.assign({
    permissionSet: 'requisitions-source-agent',
    subject: { type: 'user', id: f.agent.user.id },
  });
  await f.rules();
  const row = await f.draft(
    { ...f.content(), recipientEmployeeId: f.reviewer.employee.id },
    f.agent.session,
  );
  const response = await send(
    f.agent.session,
    `/requisitions/requests/${row.id}/submit`,
    mutation(row),
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error.reason).toBe('ISSUE_REVIEWERS_EMPTY');
  expect(
    await database
      .repository('supplyChainReviewTasks')
      .count({ filter: { subjectId: f.a.id } }),
  ).toBe(0);
});

test('keeps purpose uniqueness company-specific and refuses a foreign-company purpose', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  const duplicate = await send(f.admin, '/requisitions/purposes', {
    content: { subjectId: f.a.id, code: 'REPAIR', name: 'Duplicate' },
    requestKey: randomUUID(),
  });
  expect(duplicate.status).toBe(409);
  expect((await duplicate.json()).error.reason).toBe(
    'ISSUE_PURPOSE_CODE_DUPLICATE',
  );
  const other = await send(f.admin, '/requisitions/purposes', {
    content: { subjectId: f.b.id, code: 'REPAIR', name: 'Other company' },
    requestKey: randomUUID(),
  });
  expect(other.status).toBe(201);
  const otherPurpose = (await other.json()).data;
  const cross = await send(f.applicant.session, '/requisitions/requests', {
    content: { ...f.content(), purposeId: otherPurpose.id },
    requestKey: randomUUID(),
  });
  expect(cross.status).toBe(400);
  expect(
    await database
      .repository('materialIssueRequests')
      .count({ filter: { subjectId: f.a.id } }),
  ).toBe(0);
});

test('rolls back the parent, lines, lifecycle, replay and audit if the final audit fails', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  const service = testApp.application.container.resolve(
    issueRequestServiceToken,
  );
  const spy = vi
    .spyOn(
      service as unknown as { audit(...args: unknown[]): Promise<void> },
      'audit',
    )
    .mockRejectedValueOnce(new Error('Isolated final audit failure'));
  const key = randomUUID();
  const response = await send(f.applicant.session, '/requisitions/requests', {
    content: f.content(),
    requestKey: key,
  });
  expect(response.status).toBe(500);
  spy.mockRestore();
  expect(
    await database
      .repository('materialIssueRequests')
      .count({ filter: { subjectId: f.a.id } }),
  ).toBe(0);
  expect(
    await database
      .repository('materialIssueRequestLines')
      .count({ filter: { subjectId: f.a.id } }),
  ).toBe(0);
  expect(
    await database
      .repository('supplyChainAudit')
      .count({ filter: { subjectId: f.a.id, kind: 'materialIssueRequests' } }),
  ).toBe(0);
  expect(
    await database
      .repository('supplyChainActionRequests')
      .count({ filter: { actorId: f.applicant.user.id, requestKey: key } }),
  ).toBe(0);
  const retry = await send(f.applicant.session, '/requisitions/requests', {
    content: f.content(),
    requestKey: key,
  });
  expect(retry.status).toBe(201);
});

test('rejects non-stock issue selection and protects organization ownership with open issue references', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database),
    m = await purchaseMaterial(f as never, database);
  await database.repository('materialSkus').updateOne({
    filter: { id: m.sku.id },
    values: { managementMode: 'nonStock' },
  });
  const response = await send(f.applicant.session, '/requisitions/requests', {
    content: { ...f.content(), lines: m.content.lines },
    requestKey: randomUUID(),
  });
  expect(response.status).toBe(400);
  await f.draft();
  const { hasOpenIssueOrganizationReferences } =
    await import('../../server/providers/issue-request-references.js');
  expect(
    await hasOpenIssueOrganizationReferences(
      database.connection(),
      'subjects',
      f.a.id,
    ),
  ).toBe(true);
  expect(
    await hasOpenIssueOrganizationReferences(
      database.connection(),
      'units',
      f.unit.id,
    ),
  ).toBe(true);
  expect(
    await hasOpenIssueOrganizationReferences(
      database.connection(),
      'subjects',
      f.b.id,
    ),
  ).toBe(false);
});

test('issue-specific withdraw, return, revise, cancellation and copy keep frozen history and require a fresh review', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  await f.rules();
  let row = await f.fire(await f.draft(), 'submit');
  const originalVersion = row.submittedVersionId,
    originalLine = row.lines[0].id;
  row = await f.fire(row, 'withdraw');
  expect(row.status).toBe('draft');
  expect(row.versions).toHaveLength(1);
  expect(row.reviewTasks[0].status).toBe('closed');
  row = await f.fire(row, 'submit');
  expect(row.reviewRound).toBe(2);
  row = await f.fire(row, 'return', f.reviewer.session);
  expect(row.status).toBe('draft');
  expect(row.reviewTasks[0].status).toBe('returned');
  row = await f.fire(row, 'submit');
  row = await f.fire(row, 'approve', f.reviewer.session);
  const approved = row.approvedVersionId;
  row = await f.fire(row, 'revise');
  expect(row.status).toBe('draft');
  expect(row.approvedVersionId).toBeNull();
  expect(row.lines[0].id).toBe(originalLine);
  expect(row.versions.map((v: { id: string }) => v.id)).toContain(approved);
  expect(row.versions.map((v: { id: string }) => v.id)).toContain(
    originalVersion,
  );
  row = await f.fire(row, 'cancel');
  const response = await send(
    f.applicant.session,
    `/requisitions/requests/${row.id}/copy`,
    { ...mutation(row), content: f.content() },
  );
  expect(response.status).toBe(201);
  let copy = (await response.json()).data;
  expect(copy).toMatchObject({
    status: 'draft',
    supersedesId: row.id,
    reviewRound: 0,
  });
  expect(copy.lines[0].id).not.toBe(originalLine);
  expect(copy.versions).toHaveLength(0);
  copy = await f.fire(copy, 'submit');
  expect(copy.reviewTasks[0].candidates).toEqual([f.reviewer.user.id]);
  const history = await (
    await f.applicant.session.fetch(`/requisitions/requests/${row.id}`)
  ).json();
  expect(history.data.status).toBe('cancelled');
  expect(
    history.data.display.relatedRequests.some(
      (v: { id: string }) => v.id === copy.id,
    ),
  ).toBe(true);
});

test('issue reassign uses the frozen position selectors only after all current reviewers lose qualification', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  const response = await send(
    f.admin,
    '/requisitions/settings',
    {
      subjectId: f.a.id,
      version: 0,
      requestKey: randomUUID(),
      values: {
        reviewerSelections: [
          { group: 1, type: 'position', referenceId: f.position.id },
        ],
        allowParallelGovernance: true,
        requireProject: false,
      },
    },
    'PUT',
  );
  expect(response.status).toBe(200);
  let row = await f.fire(await f.draft(), 'submit');
  const version = row.submittedVersionId;
  expect(row.reviewTasks[0].candidates.sort()).toEqual(
    [f.reviewer.user.id, f.agent.user.id].sort(),
  );
  const newcomer = await f.person('Independent replacement');
  await f.authz.permissionSets.assign({
    permissionSet: 'requisitions-request-reviewer',
    subject: { type: 'user', id: newcomer.user.id },
  });
  expect(
    (
      await send(
        f.admin,
        `/requisitions/requests/${row.id}/reassign`,
        mutation(row),
      )
    ).status,
  ).toBe(400);
  await f.users.disable(f.reviewer.user.id);
  await f.users.disable(f.agent.user.id);
  row = await f.fire(row, 'reassign', f.admin);
  expect(row.submittedVersionId).toBe(version);
  expect(row.reviewTasks[0].candidates).toEqual([newcomer.user.id]);
  row = await f.fire(row, 'approve', newcomer.session);
  expect(row.status).toBe('approved');
});

test('PostgreSQL: competing issue review decisions overlap on two connections and commit once', async ({
  testApp,
  database,
  skip,
}) => {
  if (database.connection().dialect !== 'postgres') skip();
  const f = await setup(testApp, database);
  await f.rules();
  const row = await f.fire(await f.draft(), 'submit');
  const runtime = testApp.application.container.resolve(recordLifecycleToken);
  const historyBefore = await runtime.history('materialIssueRequests', row.id);
  const transaction = database.transaction.bind(database),
    backends: number[] = [];
  let release!: () => void,
    timedOut = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    release();
  }, 15000);
  const spy = vi
    .spyOn(database, 'transaction')
    .mockImplementation(
      async <T>(work: (c: DatabaseConnection) => Promise<T>, name?: string) =>
        transaction(async (c) => {
          const client = await c.client<{
            raw(sql: string): Promise<{ rows: { pid: number }[] }>;
          }>();
          backends.push(
            (await client.raw('select pg_backend_pid() as pid')).rows[0].pid,
          );
          if (backends.length === 2) release();
          await gate;
          return work(c);
        }, name),
    );
  let responses: Response[];
  const bodies = [mutation(row), mutation(row)];
  try {
    responses = await Promise.all(
      ['approve', 'return'].map((action, index) =>
        send(
          f.reviewer.session,
          `/requisitions/requests/${row.id}/${action}`,
          bodies[index],
        ),
      ),
    );
  } finally {
    clearTimeout(timeout);
    release();
    spy.mockRestore();
  }
  expect(timedOut).toBe(false);
  expect(new Set(backends).size).toBe(2);
  expect(responses.map((response) => response.status).sort()).toEqual([
    200, 409,
  ]);
  console.info(
    JSON.stringify({
      probe: 'issue-review-concurrency',
      backendPids: backends,
    }),
  );
  expect(
    await database
      .repository('supplyChainReviewTasks')
      .count({ filter: { issueRequestId: row.id, status: 'pending' } }),
  ).toBe(0);
  expect(
    await database
      .repository('supplyChainAudit')
      .count({ filter: { recordId: row.id } }),
  ).toBe(3);
  const history = await runtime.history('materialIssueRequests', row.id);
  expect(history.transitions).toHaveLength(
    historyBefore.transitions.length + 1,
  );
  const winner = responses.findIndex((response) => response.status === 200);
  expect(history.transitions.at(-1)!.transition).toBe(
    winner === 0 ? 'approve' : 'return',
  );
  const retry = await send(
    f.reviewer.session,
    `/requisitions/requests/${row.id}/${winner === 0 ? 'approve' : 'return'}`,
    bodies[winner],
  );
  expect(retry.status).toBe(200);
  expect(await runtime.history('materialIssueRequests', row.id)).toEqual(
    history,
  );
});
test('only the designated recipient can acknowledge issued quantities, and history records the receipt', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database),
    m = await purchaseMaterial(f as never, database);
  await f.rules();
  let row = await f.draft({ ...f.content(), lines: m.content.lines });
  row = await f.fire(row, 'submit');
  row = await f.fire(row, 'approve', f.reviewer.session);
  const line = row.lines[0];
  await database.repository('stockIssueFulfillments').createOne({
    values: {
      id: line.id,
      issueRequestId: row.id,
      subjectId: f.a.id,
      skuId: line.skuId,
      baseUnitId: line.baseUnitId,
      issuedQuantity: line.baseQuantity,
      returnedQuantity: '0',
      receivedQuantity: '0',
      revision: 1,
      nonce: randomUUID(),
    },
  });
  await database.repository('materialIssueRequests').updateOne({
    filter: { id: row.id },
    values: { fulfillmentStatus: 'issued', issuedAt: new Date() },
  });
  const detail = await (
    await f.applicant.session.fetch(`/requisitions/requests/${row.id}`)
  ).json();
  expect(detail.data.fulfillmentStatus).toBe('issued');
  expect(detail.data.lines[0].issuedQuantity).toBe(line.baseQuantity);
  const cancel = await send(
    f.applicant.session,
    `/requisitions/requests/${row.id}/cancel`,
    mutation(row),
  );
  expect(cancel.status).toBe(400);
  expect((await cancel.json()).error.reason).toBe('ISSUE_ALREADY_ISSUED');
  const denied = await send(
    f.reviewer.session,
    `/requisitions/requests/${row.id}/receive`,
    { version: row.revision, note: 'not mine' },
  );
  expect(denied.status).toBe(403);
  const received = await send(
    f.applicant.session,
    `/requisitions/requests/${row.id}/receive`,
    { version: row.revision, note: '已清点入库' },
  );
  expect(received.status).toBe(200);
  const body = (await received.json()).data;
  expect(body.fulfillmentStatus).toBe('received');
  expect(body.receivedBy).toBe(f.applicant.user.id);
  expect(body.lines[0].receivedQuantity).toBe(line.baseQuantity);
  const again = await send(
    f.applicant.session,
    `/requisitions/requests/${row.id}/receive`,
    { version: body.revision, note: 'again' },
  );
  expect(again.status).toBe(400);
  expect((await again.json()).error.reason).toBe('ISSUE_NOTHING_TO_RECEIVE');
});

// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import { createStandaloneServer } from '../../server/standalone.js';
import {
  fixture,
  purchaseMaterial,
  send,
  mutation,
} from '../helpers/purchase-requests.js';
import { materialSourceServiceToken } from '../../server/providers/material-sources.js';
import type { DatabaseConnection } from '@nocobase/db';
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
  const get = async (id: string) =>
    (
      await (
        await f.applicant.session.fetch(`/procurement/requests/${id}`)
      ).json()
    ).data;
  const request = async (
    row: Awaited<ReturnType<typeof get>>,
    index = 0,
    extra = {},
  ) => {
    const line = row.lines.filter(
      (l: { status: string }) => l.status === 'active',
    )[index];
    const body = {
      ...mutation(row),
      lineVersion: line.revision,
      inputRevision: line.inputRevision,
      ...extra,
    };
    const r = await send(
      f.applicant.session,
      `/procurement/requests/${row.id}/lines/${line.id}/requestGovernance`,
      body,
    );
    const v = await r.json();
    expect(r.status).toBe(200);
    return { source: v.data, body, line };
  };
  const resolve = async (source: { requestId: string }, skuId: string) => {
    const task = (
      await (
        await f.admin.fetch(`/materials/requests/${source.requestId}`)
      ).json()
    ).data;
    const r = await send(
      f.admin,
      `/materials/requests/${source.requestId}/resolve`,
      {
        version: task.lifecycleVersion,
        requestKey: randomUUID(),
        reason: 'Resolve isolated source',
        resolvedSkuId: skuId,
      },
    );
    return r;
  };
  return { ...f, get, request, resolve };
};
test('unknown line requests one governance task, offers a candidate without changing approval, accepts into a new draft once', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database),
    m = await purchaseMaterial(f, database);
  await f.saveRules();
  let row = await f.draft();
  const { source, body, line } = await f.request(row);
  const replay = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}/lines/${line.id}/requestGovernance`,
    body,
  );
  expect(replay.status).toBe(200);
  expect((await replay.json()).data.id).toBe(source.id);
  expect(
    await database
      .repository('materialRequestSources')
      .count({ filter: { sourceDocumentId: row.id } }),
  ).toBe(1);
  row = await f.get(row.id);
  expect(row.lines[0].identificationStatus).toBe('governing');
  row = await f.fire(row, 'submit');
  row = await f.fire(row, 'approve', f.reviewer.session);
  const approvedVersion = row.approvedVersionId,
    contentVersion = row.contentVersion;
  const resolution = await f.resolve(source, m.sku.id);
  const answer = await resolution.json();
  expect({ status: resolution.status, reason: answer.error?.reason }).toEqual({
    status: 200,
    reason: undefined,
  });
  row = await f.get(row.id);
  expect(row).toMatchObject({
    status: 'approved',
    approvedVersionId: approvedVersion,
    contentVersion,
  });
  expect(row.lines[0]).toMatchObject({
    skuId: null,
    identificationStatus: 'awaitingConfirmation',
  });
  const offered = (
    await (
      await f.applicant.session.fetch(`/procurement/requests/${row.id}/sources`)
    ).json()
  ).data[0];
  const caps = await (
    await f.applicant.session.fetch(
      `/procurement/requests/${row.id}/capabilities`,
    )
  ).json();
  expect(caps.data.actions.confirmMaterial).toMatchObject({
    visible: true,
    enabled: true,
  });
  expect(offered.display.handler).toBe('Applicant');
  const history = await (
    await f.applicant.session.fetch(
      `/procurement/requests/${row.id}/lines/${line.id}/sourceHistory?page=1&pageSize=1`,
    )
  ).json();
  expect(history.meta).toEqual({ page: 1, pageSize: 1, total: 1 });
  expect(history.data[0].id).toBe(source.id);
  const confirmation = {
    ...mutation(row),
    lineVersion: row.lines[0].revision,
    inputRevision: row.lines[0].inputRevision,
    sourceId: source.id,
    sourceVersion: offered.revision,
    unitId: String(m.each.id),
    unitRuleId: null,
  };
  const r = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}/lines/${line.id}/confirmMaterial`,
    confirmation,
  );
  const data = await r.json();
  expect({ status: r.status, reason: data.error?.reason }).toEqual({
    status: 200,
    reason: undefined,
  });
  row = await f.get(row.id);
  expect(row).toMatchObject({
    status: 'draft',
    contentVersion: contentVersion + 1,
    approvedVersionId: null,
  });
  expect(row.versions).toHaveLength(1);
  expect(row.lines[0]).toMatchObject({
    skuId: m.sku.id,
    baseQuantity: '20',
    identificationStatus: 'identified',
  });
  const retry = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}/lines/${line.id}/confirmMaterial`,
    confirmation,
  );
  expect(retry.status).toBe(200);
  expect((await f.get(row.id)).contentVersion).toBe(row.contentVersion);
  const changed = row.lines[0].selectionInput;
  changed.selection = { ...f.line().selection, quantity: '21' };
  const edited = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}`,
    { ...mutation(row), content: { ...f.content(), lines: [changed] } },
    'PATCH',
  );
  expect(edited.status).toBe(200);
  row = (await edited.json()).data;
  const expired = (
    await (
      await f.applicant.session.fetch(`/procurement/requests/${row.id}/sources`)
    ).json()
  ).data[0];
  expect(expired).toMatchObject({
    id: source.id,
    status: 'invalidated',
    resolutionSnapshot: { skuId: m.sku.id },
  });
  expect(
    (
      await (
        await f.admin.fetch(`/materials/requests/${source.requestId}`)
      ).json()
    ).data.status,
  ).toBe('resolved');
  const newRound = await f.request(row, 0, {
    retry: true,
    sourceVersion: expired.revision,
  });
  expect(newRound.source).toMatchObject({
    sourceAttempt: 2,
    status: 'pending',
  });
  expect(newRound.source.id).not.toBe(source.id);
});
test('unrelated edits preserve a line source, changed input withdraws its task and explicit retry creates one new round', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database),
    content = f.content();
  content.lines.push(f.line());
  let row = await f.draft(content);
  const { source } = await f.request(row);
  row = await f.get(row.id);
  content.notes = 'unrelated header edit';
  content.lines[1].notes = 'other line edit';
  let response = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}`,
    { ...mutation(row), content },
    'PATCH',
  );
  expect(response.status).toBe(200);
  row = (await response.json()).data;
  expect(row.lines[0]).toMatchObject({
    activeSourceLinkId: source.id,
    identificationStatus: 'governing',
    inputRevision: 1,
  });
  const reordered = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}`,
    {
      ...mutation(row),
      content: { ...content, lines: [...content.lines].reverse() },
    },
    'PATCH',
  );
  expect(reordered.status).toBe(200);
  row = (await reordered.json()).data;
  expect(
    row.lines.find((line: { id: string }) => line.id === content.lines[0].id),
  ).toMatchObject({
    activeSourceLinkId: source.id,
    inputRevision: 1,
    identificationStatus: 'governing',
  });
  content.lines[0].selection = {
    ...content.lines[0].selection,
    quantity: '21',
  };
  response = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}`,
    { ...mutation(row), content },
    'PATCH',
  );
  expect(response.status).toBe(200);
  row = (await response.json()).data;
  const old = await database
    .repository('materialRequestSources')
    .findOne({ filter: { id: source.id } });
  expect(old?.status).toBe('invalidated');
  expect(
    (
      await database
        .repository('materialRequests')
        .findOne({ filter: { id: source.requestId } })
    )?.status,
  ).toBe('withdrawn');
  const result = await f.request(row, 0, {
    retry: true,
    sourceVersion: old!.revision,
  });
  expect(result.source.sourceAttempt).toBe(2);
  expect(result.source.requestId).not.toBe(source.requestId);
  expect(
    await database
      .repository('materialRequestSources')
      .count({ filter: { sourceDocumentId: row.id } }),
  ).toBe(2);
});

test('returned governance input and rejected candidates recover through explicit new rounds while preserving resolved history', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database),
    m = await purchaseMaterial(f, database);
  let row = await f.draft();
  const first = await f.request(row);
  row = await f.get(row.id);
  const task = (
    await (
      await f.admin.fetch(`/materials/requests/${first.source.requestId}`)
    ).json()
  ).data;
  const returned = await send(
    f.admin,
    `/materials/requests/${task.id}/return`,
    {
      version: task.lifecycleVersion,
      requestKey: randomUUID(),
      reason: 'Need a clearer specification',
    },
  );
  expect(returned.status).toBe(200);
  let old = (await database
    .repository('materialRequestSources')
    .findOne({ filter: { id: first.source.id } }))!;
  expect(old.status).toBe('needsInformation');
  row = await f.get(row.id);
  const second = await f.request(row, 0, {
    retry: true,
    sourceVersion: old.revision,
  });
  expect(second.source.sourceAttempt).toBe(2);
  expect(
    (
      await database
        .repository('materialRequests')
        .findOne({ filter: { id: first.source.requestId } })
    )?.status,
  ).toBe('withdrawn');
  expect((await f.resolve(second.source, m.sku.id)).status).toBe(200);
  row = await f.get(row.id);
  const offered = (await database
    .repository('materialRequestSources')
    .findOne({ filter: { id: second.source.id } }))!;
  const line = row.lines[0],
    reject = {
      ...mutation(row),
      lineVersion: line.revision,
      inputRevision: line.inputRevision,
      sourceId: offered.id,
      sourceVersion: offered.revision,
    };
  const rejected = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}/lines/${line.id}/rejectMaterial`,
    reject,
  );
  expect(rejected.status).toBe(200);
  const replay = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}/lines/${line.id}/rejectMaterial`,
    reject,
  );
  expect(replay.status).toBe(200);
  old = (await database
    .repository('materialRequestSources')
    .findOne({ filter: { id: second.source.id } }))!;
  expect(old.status).toBe('invalidated');
  expect(
    (
      await database
        .repository('materialRequests')
        .findOne({ filter: { id: second.source.requestId } })
    )?.status,
  ).toBe('resolved');
  row = await f.get(row.id);
  const third = await f.request(row, 0, {
    retry: true,
    sourceVersion: old.revision,
  });
  expect(third.source.sourceAttempt).toBe(3);
  const history = await f.applicant.session.fetch(
    `/procurement/requests/${row.id}/lines/${line.id}/sourceHistory?page=1&pageSize=10`,
  );
  expect(history.status).toBe(200);
  expect((await history.json()).meta.total).toBe(3);
});
test('failure in source audit rolls back the official task transition and offer together', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database),
    m = await purchaseMaterial(f, database),
    row = await f.draft();
  const { source } = await f.request(row);
  const service = testApp.application.container.resolve(
    materialSourceServiceToken,
  );
  const spy = vi
    .spyOn(service as unknown as { audit: () => Promise<void> }, 'audit')
    .mockRejectedValueOnce(new Error('injected source audit failure'));
  try {
    const response = await f.resolve(source, m.sku.id);
    expect(response.status).toBe(500);
  } finally {
    spy.mockRestore();
  }
  expect(
    (
      await database
        .repository('materialRequests')
        .findOne({ filter: { id: source.requestId } })
    )?.status,
  ).toBe('pending');
  expect(
    (
      await database
        .repository('materialRequestSources')
        .findOne({ filter: { id: source.id } })
    )?.status,
  ).toBe('pending');
  expect((await f.get(row.id)).lines[0].identificationStatus).toBe('governing');
  expect((await f.resolve(source, m.sku.id)).status).toBe(200);
});

test('submission creates unknown-line sources atomically and its original request key does not duplicate them', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  await f.saveRules();
  const draft = await f.draft(),
    body = mutation(draft);
  const response = await send(
      f.applicant.session,
      `/procurement/requests/${draft.id}/submit`,
      body,
    ),
    data = await response.json();
  expect({ status: response.status, reason: data.error?.reason }).toEqual({
    status: 200,
    reason: undefined,
  });
  expect(data.data.lines[0]).toMatchObject({
    identificationStatus: 'governing',
    governanceAttempt: 1,
  });
  const source = await database
    .repository('materialRequestSources')
    .findOne({ filter: { sourceDocumentId: draft.id } });
  expect(source).toMatchObject({ status: 'pending', sourceAttempt: 1 });
  const replay = await send(
    f.applicant.session,
    `/procurement/requests/${draft.id}/submit`,
    body,
  );
  expect(replay.status).toBe(200);
  expect(
    await database
      .repository('materialRequestSources')
      .count({ filter: { sourceDocumentId: draft.id } }),
  ).toBe(1);
  const returned = await f.fire(data.data, 'return', f.reviewer.session);
  expect(
    (
      await database
        .repository('materialRequestSources')
        .findOne({ filter: { id: String(source!.id) } })
    )?.status,
  ).toBe('invalidated');
  expect(
    (
      await database
        .repository('materialRequests')
        .findOne({ filter: { id: String(source!.requestId) } })
    )?.status,
  ).toBe('withdrawn');
  const resubmitted = await f.fire(returned, 'submit');
  expect(resubmitted.lines[0].governanceAttempt).toBe(2);
});
test('revoking the source handler stops resolution; a separately authorized delegate can take over with a reason', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database),
    m = await purchaseMaterial(f, database);
  let row = await f.draft();
  const { source, line } = await f.request(row);
  const assignments = await f.authz.permissionSets.listAssignments(
    'procurement-source-requester',
  );
  const assignment = assignments.find(
    (a) => a.subject.id === f.applicant.user.id,
  )!;
  await f.authz.permissionSets.revoke(assignment.id);
  expect((await f.resolve(source, m.sku.id)).status).toBe(403);
  expect(
    (
      await database
        .repository('materialRequests')
        .findOne({ filter: { id: source.requestId } })
    )?.status,
  ).toBe('pending');
  await f.grant(f.agent.user.id, [
    'read',
    'delegate',
    'takeOverSource',
    'confirmMaterial',
    'requestGovernance',
  ]);
  row = (
    await (
      await f.agent.session.fetch(`/procurement/requests/${row.id}`)
    ).json()
  ).data;
  const takeover = await send(
    f.agent.session,
    `/procurement/requests/${row.id}/lines/${line.id}/takeOverSource`,
    {
      ...mutation(row),
      lineVersion: row.lines[0].revision,
      inputRevision: row.lines[0].inputRevision,
      sourceId: source.id,
      sourceVersion: source.revision,
    },
  );
  expect(takeover.status).toBe(200);
  expect((await f.resolve(source, m.sku.id)).status).toBe(200);
  expect(
    (
      await database
        .repository('materialRequestSources')
        .findOne({ filter: { id: source.id } })
    )?.sourceHandlerId,
  ).toBe(f.agent.user.id);
});

test('PostgreSQL: competing explicit identification requests use separate connections and create one source and task', async ({
  testApp,
  database,
  skip,
}) => {
  if (database.connection().dialect !== 'postgres') skip();
  const f = await setup(testApp, database),
    row = await f.draft(),
    line = row.lines[0];
  const bodies = [0, 1].map(() => ({
    ...mutation(row),
    lineVersion: line.revision,
    inputRevision: line.inputRevision,
  }));
  const transaction = database.transaction.bind(database),
    backends: number[] = [];
  let release!: () => void,
    timedOut = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const timer = setTimeout(() => {
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
  try {
    responses = await Promise.all(
      bodies.map((body) =>
        send(
          f.applicant.session,
          `/procurement/requests/${row.id}/lines/${line.id}/requestGovernance`,
          body,
        ),
      ),
    );
  } finally {
    clearTimeout(timer);
    release();
    spy.mockRestore();
  }
  expect(timedOut).toBe(false);
  expect(new Set(backends).size).toBe(2);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    await database
      .repository('materialRequestSources')
      .count({ filter: { sourceDocumentId: row.id } }),
  ).toBe(1);
  const source = await database
    .repository('materialRequestSources')
    .findOne({ filter: { sourceDocumentId: row.id } });
  expect(
    await database
      .repository('materialRequests')
      .count({ filter: { id: source!.requestId as string } }),
  ).toBe(1);
  const winner = responses.findIndex((r) => r.status === 200);
  const replay = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}/lines/${line.id}/requestGovernance`,
    bodies[winner],
  );
  expect(replay.status).toBe(200);
  console.info(
    JSON.stringify({
      probe: 'source-request-concurrency',
      backendPids: backends,
    }),
  );
});

// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import type { DatabaseConnection } from '@nocobase/db';
import { createStandaloneServer } from '../../server/standalone.js';
import { recordLifecycleToken } from '../../server/providers/record-lifecycle.js';
import {
  InventoryService,
  type StockPostingPort,
  type StockEntry,
} from '../../server/providers/inventory-service.js';
import { inventoryError } from '../../server/providers/inventory-quantity.js';
import {
  fixture,
  purchaseMaterial,
  send,
  mutation,
} from '../helpers/purchase-requests.js';
import type { StockReservationPort } from '../../server/providers/inventory-reservations.js';
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
  const [app, db] = args,
    f = await fixture(...args),
    m = await purchaseMaterial(f, db),
    warehouse = await f.create('/materials/warehouses', {
      name: 'Isolated quantity warehouse',
      subjectId: f.a.id,
    });
  await db
    .repository('measureUnits')
    .updateOne({ filter: { id: String(m.each.id) }, values: { precision: 6 } });
  const sku = await db.repository('materialSkus').findOne({
    filter: { id: m.sku.id },
  });
  const runtime = app.application.container.resolve(recordLifecycleToken);
  // The ledger's caller contract uses the official runtime in the SAME
  // transaction. Source approval/HTTP authorization belong to WarehouseService;
  // these tests exercise the internal quantity engine and replay boundary.
  let authorized = true,
    fault = false;
  const make = async (
    quantity: string,
    direction = 1,
    owner?: { id: string; lineId: string },
  ) => {
    const now = new Date(),
      id = randomUUID(),
      lineId = randomUUID();
    const head = {
      id,
      code: randomUUID(),
      subjectId: f.a.id,
      warehouseId: warehouse.id,
      kind: direction > 0 ? 'initial' : owner ? 'issue' : 'loss',
      originalDocumentId: null,
      issueRequestId: owner?.id ?? null,
      status: 'approved',
      revision: 1,
      lifecycleVersion: 0,
      statusChangedAt: now,
      occurredOn: '2026-10-18',
      reason: 'Isolated quantity fact',
      notes: '',
      createdBy: f.applicant.user.id,
      updatedBy: f.applicant.user.id,
      createdAt: now,
      updatedAt: now,
      postedBy: null,
      postedAt: null,
    };
    await db.repository('stockDocuments').createOne({ values: head });
    await db.repository('stockDocumentLines').createOne({
      values: {
        id: lineId,
        documentId: id,
        subjectId: f.a.id,
        lineNo: 1,
        revision: 1,
        status: 'active',
        skuId: m.sku.id,
        baseUnitId: m.each.id,
        unitId: m.each.id,
        unitRuleId: null,
        issueRequestId: owner?.id ?? null,
        issueRequestLineId: owner?.lineId ?? null,
        originalLineId: null,
        quantity,
        baseQuantity: quantity,
        numeratorSnapshot: '1',
        denominatorSnapshot: '1',
        quality: 'qualified',
        materialSnapshot: {
          code: String(sku?.code),
          name: 'Ledger fixture',
          baseUnitName: 'each',
        },
        notes: '',
      },
    });
    return {
      head,
      lineId,
      input: {
        documentId: id,
        version: 1,
        lifecycleVersion: 0,
        actorId: f.applicant.user.id,
        requestKey: randomUUID(),
        reason: 'Post isolated quantity fact',
      },
      direction,
    };
  };
  const port = (draft: Awaited<ReturnType<typeof make>>): StockPostingPort => ({
    authorize: async (c, document) => {
      if (!authorized || document.subjectId !== f.a.id)
        inventoryError('STOCK_FORBIDDEN');
      expect(c).toBeDefined();
    },
    prepare: async (_c, _document, lines) =>
      lines.map((line) => ({
        lineId: String(line.id),
        warehouseId: String(warehouse.id),
        quality: 'qualified',
        deltaQuantity: `${draft.direction < 0 ? '-' : ''}${String(line.baseQuantity)}`,
      })),
    posted: async (c, document, result) => {
      await runtime.fire('stockDocuments', String(document.id), 'post', {
        transaction: c,
        actor: { id: f.applicant.user.id },
        expect: { version: Number(document.lifecycleVersion) },
        requestId: draft.input.requestKey,
        input: { reason: draft.input.reason },
      });
      await c.repository('supplyChainAudit').createOne({
        values: {
          id: randomUUID(),
          kind: 'stockDocuments',
          recordId: document.id,
          subjectId: f.a.id,
          actorId: f.applicant.user.id,
          operation: 'post',
          reason: draft.input.reason,
          beforeValue: null,
          afterValue: { postingId: result.postingId },
          createdAt: new Date(),
        },
      });
      if (fault) throw new Error('Injected failure after lifecycle and audit');
    },
  });
  const service = new InventoryService(db);
  return {
    f,
    m,
    warehouse,
    runtime,
    make,
    port,
    service,
    revoke: () => {
      authorized = false;
    },
    fail: (enabled = true) => {
      fault = enabled;
    },
  };
};
const issueSourceFactory = async (h: Awaited<ReturnType<typeof setup>>) => {
  const { f, m } = h;
  for (const [user, permissionSet] of [
    [f.applicant.user.id, 'requisitions-requester'],
    [f.reviewer.user.id, 'requisitions-request-reviewer'],
  ] as const)
    await f.authz.permissionSets.assign({
      permissionSet,
      subject: { type: 'user', id: user },
    });
  const purpose = await f.create('/requisitions/purposes', {
    content: {
      subjectId: f.a.id,
      code: 'LEDGER',
      name: 'Ledger source',
      description: '',
    },
    requestKey: randomUUID(),
  });
  const rules = await send(
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
  expect(rules.status).toBe(200);
  return async (quantity = '20') => {
    const { suggestedSupplierId: _supplier, ...content } = f.content();
    const response = await send(f.applicant.session, '/requisitions/requests', {
      content: {
        ...content,
        recipientEmployeeId: f.applicant.employee.id,
        purposeId: purpose.id,
        lines: [
          {
            ...f.line(),
            selection: {
              kind: 'known',
              subjectId: f.a.id,
              skuId: m.sku.id,
              unitId: m.each.id,
              quantity,
            },
          },
        ],
      },
      requestKey: randomUUID(),
    });
    expect(response.status).toBe(201);
    let row = (await response.json()).data;
    for (const [transition, session] of [
      ['submit', f.applicant.session],
      ['approve', f.reviewer.session],
    ] as const) {
      const result = await send(
        session,
        `/requisitions/requests/${row.id}/${transition}`,
        mutation(row),
      );
      expect(result.status).toBe(200);
      row = (await result.json()).data;
    }
    return { id: row.id as string, lineId: row.lines[0].id as string, row };
  };
};
test('exact ledger posting, new-key business replay and revoked replay never duplicate facts', async ({
  testApp,
  database,
}) => {
  const h = await setup(testApp, database),
    draft = await h.make('9007199254740993.125');
  const result = await h.service.post(draft.input, h.port(draft));
  expect(result.replayed).toBe(false);
  expect(
    (
      await database
        .repository('stockBalances')
        .findOne({ filter: { warehouseId: h.warehouse.id } })
    )?.quantity,
  ).toBe('9007199254740993.125');
  expect(
    (
      await database
        .repository('stockDocuments')
        .findOne({ filter: { id: draft.head.id } })
    )?.status,
  ).toBe('posted');
  expect((await h.service.post(draft.input, h.port(draft))).postingId).toBe(
    result.postingId,
  );
  const secondKey = randomUUID();
  expect(
    (
      await h.service.post(
        { ...draft.input, requestKey: secondKey },
        h.port(draft),
      )
    ).replayed,
  ).toBe(true);
  expect(
    await database
      .repository('stockMovements')
      .count({ filter: { subjectId: h.f.a.id } }),
  ).toBe(1);
  expect(
    await database
      .repository('stockPostings')
      .count({ filter: { subjectId: h.f.a.id } }),
  ).toBe(1);
  expect(
    await database
      .repository('stockActionRequests')
      .count({ filter: { documentId: draft.head.id } }),
  ).toBe(2);
  expect(
    (await h.runtime.history('stockDocuments', draft.head.id)).transitions,
  ).toHaveLength(1);
  const other = await h.make('1');
  await expect(
    h.service.post({ ...other.input, requestKey: secondKey }, h.port(other)),
  ).rejects.toMatchObject({ reason: 'STOCK_REQUEST_KEY_REUSED' });
  h.revoke();
  await expect(
    h.service.post(draft.input, h.port(draft)),
  ).rejects.toMatchObject({ reason: 'STOCK_FORBIDDEN' });
  expect(
    await database
      .repository('stockMovements')
      .count({ filter: { subjectId: h.f.a.id } }),
  ).toBe(1);
});
test('failure after lifecycle and audit rolls back the entire ledger transaction including initialization', async ({
  testApp,
  database,
}) => {
  const h = await setup(testApp, database),
    draft = await h.make('1.125');
  h.fail();
  await expect(h.service.post(draft.input, h.port(draft))).rejects.toThrow(
    'Injected failure',
  );
  for (const table of [
    'warehouseStockGates',
    'stockBalances',
    'stockPostings',
    'stockMovements',
    'stockActionRequests',
  ])
    expect(
      await database.repository(table).count({
        filter:
          table === 'warehouseStockGates'
            ? { id: h.warehouse.id }
            : table === 'stockBalances'
              ? { warehouseId: h.warehouse.id }
              : { documentId: draft.head.id },
      }),
    ).toBe(0);
  expect(
    await database
      .repository('supplyChainAudit')
      .count({ filter: { recordId: draft.head.id } }),
  ).toBe(0);
  expect(
    (await h.runtime.history('stockDocuments', draft.head.id)).transitions,
  ).toHaveLength(0);
  expect(
    (
      await database
        .repository('stockDocuments')
        .findOne({ filter: { id: draft.head.id } })
    )?.status,
  ).toBe('approved');
});
test('issues consume their own reservations and preserve other documents reserved stock', async ({
  testApp,
  database,
}) => {
  const h = await setup(testApp, database),
    { f, m } = h,
    issue = await issueSourceFactory(h);
  const own = await issue(),
    other = await issue(),
    receipt = await h.make('10');
  await h.service.post(receipt.input, h.port(receipt));
  const balance = (await database
    .repository('stockBalances')
    .findOne({ filter: { warehouseId: h.warehouse.id } }))!;
  // Reservation rows here isolate consumption; creation/release are exercised below.
  for (const [owner, quantity] of [
    [own, '4'],
    [other, '6'],
  ] as const)
    await database.repository('stockReservations').createOne({
      values: {
        id: randomUUID(),
        balanceId: balance.id,
        subjectId: f.a.id,
        warehouseId: h.warehouse.id,
        skuId: m.sku.id,
        issueRequestId: owner.id,
        issueRequestLineId: owner.lineId,
        quality: 'qualified',
        quantity,
        consumedQuantity: '0',
        releasedQuantity: '0',
        remainingQuantity: quantity,
        revision: 1,
        createdBy: f.applicant.user.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  await database.repository('stockBalances').updateOne({
    filter: { id: String(balance.id) },
    values: { reservedQuantity: '10' },
  });
  const outgoing = await h.make('4', -1, own);
  await h.service.post(outgoing.input, h.port(outgoing));
  expect(
    await database
      .repository('stockBalances')
      .findOne({ filter: { warehouseId: h.warehouse.id } }),
  ).toMatchObject({
    quantity: '6',
    reservedQuantity: '6',
  });
  expect(
    await database
      .repository('stockReservations')
      .findOne({ filter: { issueRequestLineId: own.lineId } }),
  ).toMatchObject({ consumedQuantity: '4', remainingQuantity: '0' });
  expect(
    await database
      .repository('materialIssueRequests')
      .findOne({ filter: { id: own.id } }),
  ).toMatchObject({ fulfillmentStatus: 'partial' });
  const loss = await h.make('1', -1);
  await expect(h.service.post(loss.input, h.port(loss))).rejects.toMatchObject({
    reason: 'STOCK_RESERVED_BY_OTHER',
  });
  const excessive = await h.make('7', -1, other);
  await expect(
    h.service.post(excessive.input, h.port(excessive)),
  ).rejects.toMatchObject({ reason: 'STOCK_INSUFFICIENT' });
  expect(
    await database
      .repository('stockReservations')
      .findOne({ filter: { issueRequestLineId: other.lineId } }),
  ).toMatchObject({ consumedQuantity: '0', remainingQuantity: '6' });
  expect(
    await database
      .repository('stockBalances')
      .findOne({ filter: { warehouseId: h.warehouse.id } }),
  ).toMatchObject({
    quantity: '6',
    reservedQuantity: '6',
  });
  expect(
    await database
      .repository('stockPostings')
      .count({ filter: { subjectId: h.f.a.id } }),
  ).toBe(2);
});
test('PostgreSQL: independent connections racing first posting create one balance and business event', async ({
  testApp,
  database,
  skip,
}) => {
  if (database.connection().dialect !== 'postgres') skip();
  const h = await setup(testApp, database),
    draft = await h.make('10'),
    original = database.transaction.bind(database),
    pids: number[] = [];
  let release = () => {},
    arrivals = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = vi
    .spyOn(database, 'transaction')
    .mockImplementation(<T>(work: (c: DatabaseConnection) => Promise<T>) =>
      original(async (c) => {
        const client = await c.client<{
          raw(sql: string): Promise<{ rows: { pid: number }[] }>;
        }>();
        pids.push(
          (await client.raw('select pg_backend_pid() as pid')).rows[0].pid,
        );
        if (++arrivals === 2) release();
        await gate;
        return work(c);
      }),
    );
  const timer = setTimeout(release, 15000);
  let results;
  try {
    results = await Promise.all([
      h.service.post(draft.input, h.port(draft)),
      h.service.post(
        { ...draft.input, requestKey: randomUUID() },
        h.port(draft),
      ),
    ]);
  } finally {
    clearTimeout(timer);
    release();
    spy.mockRestore();
  }
  expect(new Set(pids).size).toBe(2);
  expect(new Set(results.map((result) => result.postingId)).size).toBe(1);
  expect(results.filter((result) => !result.replayed)).toHaveLength(1);
  expect(
    await database
      .repository('stockBalances')
      .count({ filter: { warehouseId: h.warehouse.id } }),
  ).toBe(1);
  expect(
    (
      await database
        .repository('stockBalances')
        .findOne({ filter: { warehouseId: h.warehouse.id } })
    )?.quantity,
  ).toBe('10');
  expect(
    await database
      .repository('stockPostings')
      .count({ filter: { subjectId: h.f.a.id } }),
  ).toBe(1);
  expect(
    await database
      .repository('stockMovements')
      .count({ filter: { subjectId: h.f.a.id } }),
  ).toBe(1);
  console.info(
    JSON.stringify({ probe: 'inventory-post-concurrency', backendPids: pids }),
  );
});

test('partial reservation, release and issue share approved remaining quantity and roll back audit failure', async ({
  testApp,
  database,
}) => {
  const h = await setup(testApp, database),
    issue = await issueSourceFactory(h),
    own = await issue('6'),
    receipt = await h.make('10');
  await h.service.post(receipt.input, h.port(receipt));
  let authorized = true,
    failAudit = false;
  const port: StockReservationPort = {
    authorize: async (_c, row) => {
      if (!authorized || row.subjectId !== h.f.a.id)
        inventoryError('STOCK_FORBIDDEN');
    },
    changed: async (c, row, action, quantity) => {
      await c.repository('supplyChainAudit').createOne({
        values: {
          id: randomUUID(),
          kind: 'stockReservations',
          recordId: row.id,
          subjectId: row.subjectId,
          actorId: h.f.applicant.user.id,
          operation: action,
          reason: 'Actual reservation verification',
          beforeValue: null,
          afterValue: { quantity },
          createdAt: new Date(),
        },
      });
      if (failAudit) throw new Error('Injected reservation audit failure');
    },
  };
  const input = (quantity: string) => ({
    reservationId: randomUUID(),
    subjectId: h.f.a.id as string,
    warehouseId: h.warehouse.id as string,
    issueRequestId: own.id,
    issueRequestLineId: own.lineId,
    quantity,
    version: own.row.revision as number,
    lifecycleVersion: own.row.lifecycleVersion as number,
    actorId: h.f.applicant.user.id,
    requestKey: randomUUID(),
    reason: 'Reserve for approved issue',
  });
  const first = input('4');
  await h.service.reservations.reserve(first, port);
  await expect(
    database.repository('stockReservations').updateOne({
      filter: { id: first.reservationId },
      values: { remainingQuantity: '3.999999' },
    }),
  ).rejects.toThrow();
  await expect(
    database.repository('stockIssueFulfillments').updateOne({
      filter: { id: own.lineId },
      values: { returnedQuantity: '0.000001' },
    }),
  ).rejects.toThrow();
  expect(await h.service.reservations.reserve(first, port)).toMatchObject({
    replayed: true,
  });
  expect(
    await h.service.reservations.reserve(
      { ...first, requestKey: randomUUID() },
      port,
    ),
  ).toMatchObject({ replayed: true });
  await expect(
    h.service.reservations.reserve(input('3'), port),
  ).rejects.toMatchObject({ reason: 'STOCK_SOURCE_REMAINING_EXCEEDED' });
  await expect(
    h.service.reservations.reserve(
      { ...input('1'), version: own.row.revision - 1 },
      port,
    ),
  ).rejects.toMatchObject({ reason: 'STOCK_VERSION_CONFLICT' });
  authorized = false;
  await expect(
    h.service.reservations.reserve(first, port),
  ).rejects.toMatchObject({ reason: 'STOCK_FORBIDDEN' });
  authorized = true;
  const release = {
    reservationId: first.reservationId,
    quantity: '1',
    version: 1,
    actorId: first.actorId,
    requestKey: randomUUID(),
    reason: 'Release an unneeded part',
  };
  failAudit = true;
  await expect(h.service.reservations.release(release, port)).rejects.toThrow(
    'Injected reservation audit failure',
  );
  expect(
    await database
      .repository('stockReservations')
      .findOne({ filter: { id: first.reservationId } }),
  ).toMatchObject({
    remainingQuantity: '4',
    releasedQuantity: '0',
    revision: 1,
  });
  expect(
    await database.repository('stockActionRequests').count({
      filter: { actorId: first.actorId, requestKey: release.requestKey },
    }),
  ).toBe(0);
  failAudit = false;
  await h.service.reservations.release(release, port);
  expect(await h.service.reservations.release(release, port)).toMatchObject({
    replayed: true,
  });
  await h.service.reservations.reserve(input('3'), port);
  const outgoing = await h.make('4', -1, own);
  h.fail();
  await expect(
    h.service.post(outgoing.input, h.port(outgoing)),
  ).rejects.toThrow('Injected failure after lifecycle and audit');
  expect(
    await database
      .repository('stockIssueFulfillments')
      .findOne({ filter: { id: own.lineId } }),
  ).toMatchObject({ issuedQuantity: '0' });
  expect(
    await database
      .repository('stockReservationConsumptions')
      .count({ filter: { documentId: outgoing.head.id } }),
  ).toBe(0);
  expect(
    await database
      .repository('stockBalances')
      .findOne({ filter: { warehouseId: h.warehouse.id } }),
  ).toMatchObject({ quantity: '10', reservedQuantity: '6' });
  h.fail(false);
  await h.service.post(outgoing.input, h.port(outgoing));
  expect(
    await database
      .repository('stockReservationConsumptions')
      .count({ filter: { documentId: outgoing.head.id } }),
  ).toBe(2);
  expect(
    await database
      .repository('stockIssueFulfillments')
      .findOne({ filter: { id: own.lineId } }),
  ).toMatchObject({ issuedQuantity: '4', returnedQuantity: '0' });
  expect(
    await database
      .repository('stockBalances')
      .findOne({ filter: { warehouseId: h.warehouse.id } }),
  ).toMatchObject({ quantity: '6', reservedQuantity: '2' });
  await expect(
    h.service.reservations.reserve(input('1'), port),
  ).rejects.toMatchObject({ reason: 'STOCK_SOURCE_REMAINING_EXCEEDED' });
  const excessive = await h.make('3', -1, own);
  await expect(
    h.service.post(excessive.input, h.port(excessive)),
  ).rejects.toMatchObject({ reason: 'STOCK_SOURCE_REMAINING_EXCEEDED' });
  expect(
    await database
      .repository('stockIssueFulfillments')
      .findOne({ filter: { id: own.lineId } }),
  ).toMatchObject({ issuedQuantity: '4' });
  expect(
    await database
      .repository('stockReservations')
      .count({ filter: { issueRequestLineId: own.lineId } }),
  ).toBe(2);
});

test('PostgreSQL: different warehouses cannot reserve or issue more than one approved source', async ({
  testApp,
  database,
  skip,
}) => {
  if (database.connection().dialect !== 'postgres') skip();
  const h = await setup(testApp, database),
    issue = await issueSourceFactory(h),
    own = await issue('6'),
    second = await h.f.create('/materials/warehouses', {
      name: 'Second isolated warehouse',
      subjectId: h.f.a.id,
    }),
    warehouseIds = [String(h.warehouse.id), String(second.id)];
  const make = async (warehouseId: string, quantity: string, direction = 1) => {
    const doc = await h.make(
      quantity,
      direction,
      direction < 0 ? own : undefined,
    );
    await database
      .repository('stockDocuments')
      .updateOne({ filter: { id: doc.head.id }, values: { warehouseId } });
    const port = h.port(doc);
    port.prepare = async (_c, _document, lines) =>
      lines.map((line) => ({
        lineId: String(line.id),
        warehouseId,
        quality: 'qualified',
        deltaQuantity: `${direction < 0 ? '-' : ''}${String(line.baseQuantity)}`,
      }));
    return { doc, port };
  };
  for (const warehouseId of warehouseIds) {
    const receipt = await make(warehouseId, '10');
    await h.service.post(receipt.doc.input, receipt.port);
  }
  const port: StockReservationPort = {
    authorize: async (_c, row) => {
      if (row.subjectId !== h.f.a.id) inventoryError('STOCK_FORBIDDEN');
    },
    changed: async () => {},
  };
  const inputs = warehouseIds.map((warehouseId) => ({
    reservationId: randomUUID(),
    subjectId: String(h.f.a.id),
    warehouseId,
    issueRequestId: own.id,
    issueRequestLineId: own.lineId,
    quantity: '4',
    version: Number(own.row.revision),
    lifecycleVersion: Number(own.row.lifecycleVersion),
    actorId: h.f.applicant.user.id,
    requestKey: randomUUID(),
    reason: 'Concurrent warehouse reservation',
  }));
  const race = async <T>(work: (() => Promise<T>)[]) => {
    const original = database.transaction.bind(database),
      pids: number[] = [];
    let release = () => {},
      arrivals = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(database, 'transaction')
      .mockImplementation(<R>(run: (c: DatabaseConnection) => Promise<R>) =>
        original(async (c) => {
          const client = await c.client<{
            raw(sql: string): Promise<{ rows: { pid: number }[] }>;
          }>();
          pids.push(
            (await client.raw('select pg_backend_pid() as pid')).rows[0].pid,
          );
          if (++arrivals === 2) release();
          await gate;
          return run(c);
        }),
      );
    const timer = setTimeout(release, 15000);
    try {
      const results = await Promise.allSettled(work.map((run) => run()));
      expect(new Set(pids).size).toBe(2);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(
        rejected?.status === 'rejected' ? rejected.reason : undefined,
      ).toMatchObject({ reason: 'STOCK_SOURCE_REMAINING_EXCEEDED' });
      console.info(
        JSON.stringify({ probe: 'inventory-source-race', backendPids: pids }),
      );
      return results;
    } finally {
      clearTimeout(timer);
      release();
      spy.mockRestore();
    }
  };
  const result = await race(
      inputs.map((input) => () => h.service.reservations.reserve(input, port)),
    ),
    winner = inputs[result.findIndex((value) => value.status === 'fulfilled')];
  await h.service.reservations.release(
    {
      reservationId: winner.reservationId,
      version: 1,
      quantity: '4',
      actorId: winner.actorId,
      requestKey: randomUUID(),
      reason: 'Release verification hold',
    },
    port,
  );
  const documents = [];
  for (const warehouseId of warehouseIds)
    documents.push(await make(warehouseId, '4', -1));
  await race(
    documents.map(
      ({ doc, port }) =>
        () =>
          h.service.post(doc.input, port),
    ),
  );
  expect(
    await database
      .repository('stockIssueFulfillments')
      .findOne({ filter: { id: own.lineId } }),
  ).toMatchObject({ issuedQuantity: '4', returnedQuantity: '0' });
  expect(
    await database
      .repository('stockPostings')
      .count({ filter: { subjectId: String(h.f.a.id) } }),
  ).toBe(3);
});

test('transfer transit is a distinct exact dimension and partial receipt conserves company stock', async ({
  testApp,
  database,
}) => {
  const h = await setup(testApp, database),
    receipt = await h.make('10');
  await h.service.post(receipt.input, h.port(receipt));
  const destination = await h.f.create('/materials/warehouses', {
      name: 'Transit destination',
      subjectId: h.f.a.id,
    }),
    transferId = randomUUID(),
    transferLineId = randomUUID(),
    now = new Date();
  await database.repository('stockTransfers').createOne({
    values: {
      id: transferId,
      code: randomUUID(),
      subjectId: h.f.a.id,
      warehouseId: h.warehouse.id,
      destinationWarehouseId: destination.id,
      status: 'approved',
      revision: 1,
      lifecycleVersion: 0,
      statusChangedAt: now,
      occurredOn: '2026-10-19',
      reason: 'Isolated transfer basis',
      notes: '',
      nonce: randomUUID(),
      createdBy: h.f.applicant.user.id,
      updatedBy: h.f.applicant.user.id,
      createdAt: now,
      updatedAt: now,
    },
  });
  await database.repository('stockTransferLines').createOne({
    values: {
      id: transferLineId,
      transferId,
      subjectId: h.f.a.id,
      skuId: h.m.sku.id,
      baseUnitId: h.m.each.id,
      unitId: h.m.each.id,
      unitRuleId: null,
      lineNo: 1,
      revision: 1,
      status: 'active',
      nonce: randomUUID(),
      quantity: '10',
      baseQuantity: '10',
      numeratorSnapshot: '1',
      denominatorSnapshot: '1',
      dispatchedQuantity: '0',
      receivedQuantity: '0',
      discrepancyQuantity: '0',
      quality: 'qualified',
      selectionInput: {},
      materialSnapshot: {},
      notes: '',
    },
  });
  const make = async (quantity: string, dispatch: boolean) => {
    const doc = await h.make(quantity),
      warehouseId = dispatch ? String(h.warehouse.id) : String(destination.id);
    await database.repository('stockDocuments').updateOne({
      filter: { id: doc.head.id },
      values: {
        kind: dispatch ? 'transferDispatch' : 'transferReceipt',
        transferId,
        warehouseId,
      },
    });
    await database.repository('stockDocumentLines').updateOne({
      filter: { id: doc.lineId },
      values: { transferId, transferLineId },
    });
    const port = h.port(doc);
    port.warehouseIds = async () => [
      String(h.warehouse.id),
      String(destination.id),
    ];
    port.prepare = async (): Promise<StockEntry[]> => [
      {
        lineId: doc.lineId,
        warehouseId,
        quality: 'qualified',
        deltaQuantity: `${dispatch ? '-' : ''}${quantity}`,
      },
      {
        lineId: doc.lineId,
        transferId,
        quality: 'qualified',
        deltaQuantity: `${dispatch ? '' : '-'}${quantity}`,
      },
    ];
    return { doc, port };
  };
  const outgoing = await make('10', true);
  await h.service.post(outgoing.doc.input, outgoing.port);
  const partial = await make('3.125', false);
  await h.service.post(partial.doc.input, partial.port);
  expect(
    await database
      .repository('stockBalances')
      .findOne({ filter: { transferId } }),
  ).toMatchObject({
    warehouseId: null,
    quantity: '6.875',
    reservedQuantity: '0',
  });
  expect(
    await database
      .repository('stockBalances')
      .findOne({ filter: { warehouseId: String(destination.id) } }),
  ).toMatchObject({ transferId: null, quantity: '3.125' });
  const excessive = await make('7', false);
  await expect(
    h.service.post(excessive.doc.input, excessive.port),
  ).rejects.toMatchObject({ reason: 'STOCK_INSUFFICIENT' });
  const rows = await database
    .repository('stockBalances')
    .findMany({ filter: { subjectId: String(h.f.a.id) } });
  expect(rows.map((row) => String(row.quantity)).sort()).toEqual([
    '0',
    '3.125',
    '6.875',
  ]);
  expect(
    await database
      .repository('stockMovements')
      .count({ filter: { documentId: partial.doc.head.id } }),
  ).toBe(2);
  expect(
    await database
      .repository('stockPostings')
      .count({ filter: { documentId: excessive.doc.head.id } }),
  ).toBe(0);
});

test('reversal must be the complete inverse and cannot remove already used stock or overwrite original facts', async ({
  testApp,
  database,
}) => {
  const h = await setup(testApp, database),
    receipt = await h.make('10'),
    posted = await h.service.post(receipt.input, h.port(receipt)),
    loss = await h.make('1', -1);
  await h.service.post(loss.input, h.port(loss));
  const makeReverse = async () => {
    const doc = await h.make('10');
    await database.repository('stockDocuments').updateOne({
      filter: { id: doc.head.id },
      values: {
        kind: 'reversal',
        originalDocumentId: receipt.head.id,
        originalPostingId: posted.postingId,
      },
    });
    await database.repository('stockDocumentLines').updateOne({
      filter: { id: doc.lineId },
      values: {
        originalDocumentId: receipt.head.id,
        originalLineId: receipt.lineId,
      },
    });
    const port = h.port(doc);
    port.prepare = async () => [
      {
        lineId: doc.lineId,
        warehouseId: String(h.warehouse.id),
        quality: 'qualified',
        deltaQuantity: '-10',
      },
    ];
    return { doc, port };
  };
  const reverse = await makeReverse();
  const wrong = {
    ...reverse.port,
    prepare: async () => [
      {
        lineId: reverse.doc.lineId,
        warehouseId: String(h.warehouse.id),
        quality: 'qualified' as const,
        deltaQuantity: '-9',
      },
    ],
  };
  await expect(h.service.post(reverse.doc.input, wrong)).rejects.toMatchObject({
    reason: 'STOCK_REVERSE_SOURCE_UNAVAILABLE',
  });
  await expect(
    h.service.post(reverse.doc.input, reverse.port),
  ).rejects.toMatchObject({ reason: 'STOCK_INSUFFICIENT' });
  expect(
    await database
      .repository('stockPostings')
      .count({ filter: { reversesPostingId: posted.postingId } }),
  ).toBe(0);
  const restock = await h.make('1');
  await h.service.post(restock.input, h.port(restock));
  const result = await h.service.post(reverse.doc.input, reverse.port);
  expect(
    await database
      .repository('stockPostings')
      .findOne({ filter: { id: result.postingId } }),
  ).toMatchObject({ reversesPostingId: posted.postingId });
  expect(
    await database
      .repository('stockBalances')
      .findOne({ filter: { warehouseId: String(h.warehouse.id) } }),
  ).toMatchObject({ quantity: '0', reservedQuantity: '0' });
  expect(
    await database
      .repository('stockMovements')
      .findOne({ filter: { postingId: posted.postingId } }),
  ).toMatchObject({ deltaQuantity: '10' });
  const duplicate = await makeReverse();
  await expect(
    h.service.post(duplicate.doc.input, duplicate.port),
  ).rejects.toMatchObject({ reason: 'STOCK_ALREADY_REVERSED' });
  expect(
    (await h.runtime.history('stockDocuments', receipt.head.id)).transitions,
  ).toHaveLength(1);
});

test('a non-stock acceptance event records one business posting and no stock movements or balance', async ({
  testApp,
  database,
}) => {
  const h = await setup(testApp, database);
  // Internal posting-port fixture only; procurement approval/acceptance APIs
  // separately own the supplier, source and fulfilled-quantity requirements.
  await database.repository('materialSkus').updateOne({
    filter: { id: h.m.sku.id },
    values: { managementMode: 'nonStock' },
  });
  const doc = await h.make('5');
  await database.repository('stockDocuments').updateOne({
    filter: { id: doc.head.id },
    values: { kind: 'purchaseReceipt' },
  });
  const port = h.port(doc);
  port.prepare = async () => [];
  const result = await h.service.post(doc.input, port);
  expect(result.replayed).toBe(false);
  expect(
    (await h.service.post({ ...doc.input, requestKey: randomUUID() }, port))
      .replayed,
  ).toBe(true);
  expect(
    await database
      .repository('stockPostings')
      .count({ filter: { documentId: doc.head.id } }),
  ).toBe(1);
  expect(
    await database
      .repository('stockMovements')
      .count({ filter: { documentId: doc.head.id } }),
  ).toBe(0);
  expect(
    await database
      .repository('stockBalances')
      .count({ filter: { warehouseId: String(h.warehouse.id) } }),
  ).toBe(0);
});

test('reversing an issue restores reservations; cancellation then requires releasing them', async ({
  testApp,
  database,
}) => {
  const h = await setup(testApp, database),
    issue = await issueSourceFactory(h),
    own = await issue('6'),
    receipt = await h.make('10');
  await h.service.post(receipt.input, h.port(receipt));
  const port: StockReservationPort = {
    authorize: async (_c, row) => {
      if (row.subjectId !== h.f.a.id) inventoryError('STOCK_FORBIDDEN');
    },
    changed: async () => {},
  };
  const reserve = async (quantity: string) => {
    const input = {
      reservationId: randomUUID(),
      subjectId: String(h.f.a.id),
      warehouseId: String(h.warehouse.id),
      issueRequestId: own.id,
      issueRequestLineId: own.lineId,
      quantity,
      version: Number(own.row.revision),
      lifecycleVersion: Number(own.row.lifecycleVersion),
      actorId: h.f.applicant.user.id,
      requestKey: randomUUID(),
      reason: 'Reserve actual issue',
    };
    await h.service.reservations.reserve(input, port);
    return input;
  };
  const reverse = async (
    original: Awaited<ReturnType<typeof h.make>>,
    postingId: string,
  ) => {
    const doc = await h.make('4');
    await database.repository('stockDocuments').updateOne({
      filter: { id: doc.head.id },
      values: {
        kind: 'reversal',
        originalDocumentId: original.head.id,
        originalPostingId: postingId,
      },
    });
    await database.repository('stockDocumentLines').updateOne({
      filter: { id: doc.lineId },
      values: {
        originalDocumentId: original.head.id,
        originalLineId: original.lineId,
      },
    });
    const callback = h.port(doc),
      posted = callback.posted;
    callback.prepare = async () => [
      {
        lineId: doc.lineId,
        warehouseId: String(h.warehouse.id),
        quality: 'qualified',
        deltaQuantity: '4',
      },
    ];
    callback.posted = async (c, head, result) => {
      // Internal business-port effect; WarehouseService will derive and lock
      // the same source update from the original public document.
      await posted(c, head, result);
      const fulfilled = await c
        .repository('stockIssueFulfillments')
        .findOne({ filter: { id: own.lineId } });
      expect(fulfilled?.issuedQuantity).toBe('4');
      await c.repository('stockIssueFulfillments').updateOne({
        filter: { id: own.lineId },
        values: {
          issuedQuantity: '0',
          revision: Number(fulfilled?.revision) + 1,
        },
      });
    };
    const result = await h.service.post(doc.input, callback);
    return { doc, result };
  };
  const split = [await reserve('2'), await reserve('2')],
    outgoing = await h.make('4', -1, own),
    posted = await h.service.post(outgoing.input, h.port(outgoing));
  const restored = await reverse(outgoing, posted.postingId);
  expect(
    await database.repository('stockReservationConsumptions').count({
      filter: {
        postingId: restored.result.postingId,
        kind: 'restore',
        restoredActive: true,
      },
    }),
  ).toBe(2);
  expect(
    await database
      .repository('stockBalances')
      .findOne({ filter: { warehouseId: String(h.warehouse.id) } }),
  ).toMatchObject({ quantity: '10', reservedQuantity: '4' });
  for (const input of split) {
    const row = await database
      .repository('stockReservations')
      .findOne({ filter: { id: input.reservationId } });
    expect(row).toMatchObject({
      consumedQuantity: '0',
      remainingQuantity: '2',
      releasedQuantity: '0',
    });
    await h.service.reservations.release(
      {
        reservationId: input.reservationId,
        version: Number(row?.revision),
        quantity: '2',
        actorId: input.actorId,
        requestKey: randomUUID(),
        reason: 'Release restored reservation',
      },
      port,
    );
  }
  const last = await reserve('4'),
    second = await h.make('4', -1, own),
    secondPost = await h.service.post(second.input, h.port(second));
  const blocked = await send(
    h.f.applicant.session,
    `/requisitions/requests/${own.id}/cancel`,
    mutation(own.row),
  );
  expect(blocked.status).toBe(400);
  const released = await reverse(second, secondPost.postingId);
  const lastRow = await database
    .repository('stockReservations')
    .findOne({ filter: { id: last.reservationId } });
  await h.service.reservations.release(
    {
      reservationId: last.reservationId,
      version: Number(lastRow?.revision),
      quantity: '4',
      actorId: last.actorId,
      requestKey: randomUUID(),
      reason: 'Release before cancellation',
    },
    port,
  );
  const cancelled = await send(
    h.f.applicant.session,
    `/requisitions/requests/${own.id}/cancel`,
    mutation(own.row),
  );
  expect(cancelled.status).toBe(200);
  expect(
    await database.repository('stockReservationConsumptions').findOne({
      filter: { postingId: released.result.postingId, kind: 'restore' },
    }),
  ).toMatchObject({ quantity: '4' });
  expect(
    await database
      .repository('stockReservations')
      .findOne({ filter: { id: last.reservationId } }),
  ).toMatchObject({
    consumedQuantity: '0',
    releasedQuantity: '4',
    remainingQuantity: '0',
  });
  expect(
    await database
      .repository('stockBalances')
      .findOne({ filter: { warehouseId: String(h.warehouse.id) } }),
  ).toMatchObject({ quantity: '10', reservedQuantity: '0' });
  expect(await h.service.reservations.reserve(last, port)).toMatchObject({
    replayed: true,
  });
  expect(
    await h.service.reservations.reserve(
      { ...last, requestKey: randomUUID() },
      port,
    ),
  ).toMatchObject({ replayed: true });
  expect(
    await database
      .repository('stockReservations')
      .findOne({ filter: { id: last.reservationId } }),
  ).toMatchObject({ remainingQuantity: '0', releasedQuantity: '4' });
  const fact = await database
    .repository('stockReservationConsumptions')
    .findOne({
      filter: { postingId: restored.result.postingId },
      sort: (s) => [s.field('id').asc()],
    });
  await expect(
    database.repository('stockReservationConsumptions').updateOne({
      filter: { id: String(fact?.id) },
      values: { quantity: '1' },
    }),
  ).rejects.toThrow();
});

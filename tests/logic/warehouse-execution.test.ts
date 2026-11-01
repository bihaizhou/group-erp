// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import { createStandaloneServer } from '../../server/standalone.js';
import { executionFixture } from '../helpers/execution.js';
import { send, mutation } from '../helpers/purchase-requests.js';
import { executionRecordsToken } from '../../server/providers/execution.js';
import {
  apiDocsToken,
  findUndeclaredApiRoutes,
  findApiDocumentSchemaProblems,
} from '@nocobase/app-server/router';
// The stock suites boot an isolated application per case and run dozens of
// serialized postings; under the full-suite worker pool a 30s budget turns
// scheduler contention into false failures.
vi.setConfig({ testTimeout: 90_000 });

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
const setup = async (...args: Parameters<typeof executionFixture>) => {
  const f = await executionFixture(...args),
    db = args[1],
    header = {
      subjectId: f.a.id,
      warehouseId: f.warehouse.id,
      occurredOn: '2026-10-19',
      reason: 'Actual isolated warehouse execution',
      notes: '',
    };
  for (const resource of [
    'procurement.orders',
    'sales.orders',
    'warehouse.documents',
    'warehouse.transfers',
    'warehouse.counts',
  ])
    await f.grant(f.reviewer.user.id, resource, ['read', 'review']);
  await db.repository('materialSubjectSettings').updateOne({
    filter: { id: String(f.m.admission.id) },
    values: { canSell: true },
  });
  const doc = async (content: unknown) =>
    f.create('/warehouse/documents', { content, requestKey: randomUUID() });
  const fire = async (
    base: string,
    row: Parameters<typeof mutation>[0] & { id: string },
    action: string,
    session = f.admin,
  ) => {
    const response = await send(
        session,
        `${base}/${row.id}/${action}`,
        mutation(row),
      ),
      body = await response.json();
    if (response.status !== 200)
      throw new Error(
        JSON.stringify({ status: response.status, error: body.error }),
      );
    expect(response.status).toBe(200);
    return body.data;
  };
  const initial = async (quantity = '20', warehouseId = f.warehouse.id) => {
    const row = await doc({
      ...header,
      warehouseId,
      kind: 'initial',
      initializationReference: randomUUID(),
      lines: [
        {
          id: randomUUID(),
          selection: f.line(quantity).selection,
          quality: 'qualified',
          notes: '',
        },
      ],
    });
    await fire('/warehouse/documents', row, 'post');
    return row;
  };
  const balance = async (warehouseId = f.warehouse.id, quality = 'qualified') =>
    db.repository('stockBalances').findOne({
      filter: {
        warehouseId: String(warehouseId),
        skuId: f.m.sku.id,
        quality,
      },
    });
  return { ...f, requestFire: f.fire, header, doc, fire, initial, balance };
};
test('warehouse and inventory APIs authenticate before validation, deny unrelated roles, and declare every HTTP/schema contract', async ({
  testApp,
  database,
  request,
}) => {
  const f = await setup(testApp, database);
  for (const base of [
    '/warehouse/documents',
    '/warehouse/transfers',
    '/warehouse/counts',
    '/warehouse/inventory',
  ]) {
    expect((await request(base)).status).toBe(401);
    expect(
      (await send(f.applicant.session, base, { invalid: true })).status,
    ).toBe(base.endsWith('inventory') ? 404 : 403);
    expect(
      (await f.applicant.session.fetch(`${base}?subjectId=${f.a.id}`)).status,
    ).toBe(403);
  }
  const docs = testApp.application.container.resolve(apiDocsToken),
    document = await docs.getDocument();
  expect(findUndeclaredApiRoutes(testApp.application)).toEqual([]);
  expect(findApiDocumentSchemaProblems(document)).toEqual([]);
  expect(document.paths).toHaveProperty('/api/warehouse/counts/{id}/start');
  expect(document.paths).toHaveProperty(
    '/api/warehouse/inventory/reservations/{id}/release',
  );
});
test('posts partial purchase receipt/inspection/return, protects original quantities and commercial privacy, and reverses append-only', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database),
    base = '/procurement/orders';
  // A real approved demand is required; an unallocated order stays a draft.
  await f.saveRules();
  const demand = await f.draft(f.m.content);
  let source = await f.requestFire(demand, 'submit');
  source = await f.requestFire(source, 'approve', f.reviewer.session);
  const orderContent = f.orderContent('10');
  orderContent.lines[0].unitPrice = '19.90';
  orderContent.lines[0].allocations = [
    {
      requestId: source.id,
      requestLineId: source.lines[0].id,
      requestVersionId: source.approvedVersionId,
      baseQuantity: '10',
    },
  ];
  await f.orderRules('purchaseOrders');
  let order = await f.create(base, {
    content: orderContent,
    requestKey: randomUUID(),
  });
  order = await f.fire(base, order, 'submit');
  order = await f.fire(base, order, 'approve', f.reviewer.session);
  const receiptContent = {
    ...f.header,
    kind: 'purchaseReceipt',
    purchaseOrderId: order.id,
    lines: [
      {
        id: randomUUID(),
        purchaseOrderLineId: orderContent.lines[0].id,
        quantity: '6',
        rejectedQuantity: '1',
        quality: 'inspection',
        notes: '',
      },
    ],
  };
  const receipt = await f.doc(receiptContent);
  await f.fire('/warehouse/documents', receipt, 'post');
  expect((await f.balance(f.warehouse.id, 'inspection'))?.quantity).toBe('5');
  expect(
    (
      await database
        .repository('purchaseOrderLines')
        .findOne({ filter: { id: orderContent.lines[0].id } })
    )?.fulfilledQuantity,
  ).toBe('5');
  expect(
    (
      await database
        .repository('stockDocumentLines')
        .findOne({ filter: { documentId: receipt.id } })
    )?.baseRejectedQuantity,
  ).toBe('1');
  const excess = await f.doc({
    ...receiptContent,
    lines: [{ ...receiptContent.lines[0], id: randomUUID(), quantity: '7' }],
  });
  expect(
    (
      await send(
        f.admin,
        `/warehouse/documents/${excess.id}/post`,
        mutation(excess),
      )
    ).status,
  ).toBe(400);
  const returned = await f.doc({
    ...f.header,
    kind: 'purchaseReturn',
    originalDocumentId: receipt.id,
    lines: [
      {
        id: randomUUID(),
        originalLineId: receipt.lines[0].id,
        quantity: '2',
        quality: 'inspection',
        replenishmentRequested: true,
        notes: '',
      },
    ],
  });
  await f.fire('/warehouse/documents', returned, 'post');
  const originalPosting = await database
      .repository('stockPostings')
      .findOne({ filter: { documentId: receipt.id } }),
    inverse = await f.doc({
      ...f.header,
      kind: 'reversal',
      originalDocumentId: receipt.id,
      originalPostingId: originalPosting!.id,
      evidence: 'Incorrect receipt, inverse facts required',
    });
  expect(
    (
      await send(
        f.admin,
        `/warehouse/documents/${inverse.id}/post`,
        mutation(inverse),
      )
    ).status,
  ).toBe(400);
  const orderLine = await database
    .repository('purchaseOrderLines')
    .findOne({ filter: { id: orderContent.lines[0].id } });
  expect(orderLine).toMatchObject({
    fulfilledQuantity: '5',
    returnedQuantity: '2',
    replacementQuantity: '2',
  });
  await f.grant(f.applicant.user.id, 'warehouse.documents', ['read']);
  const detail = await f.applicant.session.fetch(
      `/warehouse/documents/${receipt.id}`,
    ),
    body = await detail.json();
  expect(detail.status).toBe(200);
  expect(JSON.stringify(body)).not.toContain('19.90');
  expect(body.data.lines[0]).not.toHaveProperty('commercialSnapshot');
  const initial = await f.initial('3'),
    posting = await database
      .repository('stockPostings')
      .findOne({ filter: { documentId: initial.id } }),
    reverse = await f.doc({
      ...f.header,
      kind: 'reversal',
      originalDocumentId: initial.id,
      originalPostingId: posting!.id,
      evidence: 'Duplicate initial reference correction',
    });
  const before = await database.repository('stockMovements').count();
  await f.fire('/warehouse/documents', reverse, 'post');
  expect(await database.repository('stockMovements').count()).toBe(before + 1);
  expect(
    (
      await database
        .repository('stockDocuments')
        .findOne({ filter: { id: initial.id } })
    )?.status,
  ).toBe('posted');
  expect((await f.balance())?.quantity).toBe('0');
});
test('sales reservations consume their own held stock, protect other orders, and returns await inspection', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  await f.initial('10');
  const role = await send(f.admin, '/sales/customerRoles', {
    partnerId: f.supplier.partnerId,
    subjectId: f.a.id,
    requestKey: randomUUID(),
  });
  expect(role.status).toBe(201);
  await f.orderRules('salesOrders');
  const makeOrder = async (quantity: string) => {
    const content = f.orderContent(quantity);
    let row = await f.create('/sales/orders', {
      content,
      requestKey: randomUUID(),
    });
    row = await f.fire('/sales/orders', row, 'submit');
    row = await f.fire('/sales/orders', row, 'approve', f.reviewer.session);
    return { row, line: content.lines[0] };
  };
  const a = await makeOrder('6'),
    b = await makeOrder('6');
  const reserve = async (order: typeof a, quantity: string) =>
    send(f.admin, '/warehouse/inventory/reservations', {
      reservationId: randomUUID(),
      sourceKind: 'sales',
      sourceId: order.row.id,
      sourceLineId: order.line.id,
      warehouseId: f.warehouse.id,
      quantity,
      ...mutation(order.row),
    });
  const held = await reserve(a, '6');
  expect(held.status).toBe(200);
  expect((await reserve(b, '5')).status).toBe(400);
  expect((await f.balance())?.reservedQuantity).toBe('6');
  const shipment = await f.doc({
    ...f.header,
    kind: 'salesShipment',
    salesOrderId: a.row.id,
    lines: [
      {
        id: randomUUID(),
        salesOrderLineId: a.line.id,
        quantity: '4',
        notes: '',
      },
    ],
  });
  await f.fire('/warehouse/documents', shipment, 'post');
  expect(await f.balance()).toMatchObject({
    quantity: '6',
    reservedQuantity: '2',
  });
  const other = await f.doc({
    ...f.header,
    kind: 'salesShipment',
    salesOrderId: b.row.id,
    lines: [
      {
        id: randomUUID(),
        salesOrderLineId: b.line.id,
        quantity: '5',
        notes: '',
      },
    ],
  });
  expect(
    (
      await send(
        f.admin,
        `/warehouse/documents/${other.id}/post`,
        mutation(other),
      )
    ).status,
  ).toBe(400);
  const returned = await f.doc({
    ...f.header,
    kind: 'salesReturn',
    originalDocumentId: shipment.id,
    lines: [
      {
        id: randomUUID(),
        originalLineId: shipment.lines[0].id,
        quantity: '2',
        condition: 'Packaging damaged, inspection required',
        notes: '',
      },
    ],
  });
  await f.fire('/warehouse/documents', returned, 'post');
  expect((await f.balance(f.warehouse.id, 'inspection'))?.quantity).toBe('2');
  expect((await f.balance())?.quantity).toBe('6');
});
test('transfers retain partial in-transit facts; count freeze covers reservations and all movements while other warehouses remain open', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database),
    destination = await f.create('/materials/warehouses', {
      name: 'Actual destination',
      subjectId: f.a.id,
    });
  await f.initial('20');
  await f.orderRules('stockTransfers');
  const content = {
    ...f.header,
    destinationWarehouseId: destination.id,
    lines: [{ id: randomUUID(), selection: f.line('8').selection, notes: '' }],
  };
  let transfer = await f.create('/warehouse/transfers', {
    content,
    requestKey: randomUUID(),
  });
  transfer = await f.fire('/warehouse/transfers', transfer, 'submit');
  transfer = await f.fire(
    '/warehouse/transfers',
    transfer,
    'approve',
    f.reviewer.session,
  );
  const dispatch = await f.doc({
    ...f.header,
    kind: 'transferDispatch',
    transferId: transfer.id,
    lines: [
      {
        id: randomUUID(),
        transferLineId: content.lines[0].id,
        quantity: '6',
        notes: '',
      },
    ],
  });
  await f.fire('/warehouse/documents', dispatch, 'post');
  const receive = await f.doc({
    ...f.header,
    warehouseId: destination.id,
    kind: 'transferReceipt',
    transferId: transfer.id,
    lines: [
      {
        id: randomUUID(),
        transferLineId: content.lines[0].id,
        quantity: '4',
        notes: '',
      },
    ],
  });
  await f.fire('/warehouse/documents', receive, 'post');
  expect(
    await database
      .repository('stockBalances')
      .findOne({ filter: { transferId: transfer.id } }),
  ).toMatchObject({ quantity: '2', warehouseId: null });
  expect((await f.balance(destination.id))?.quantity).toBe('4');
  await f.orderRules('stockCounts');
  let count = await f.create('/warehouse/counts', {
    content: f.header,
    requestKey: randomUUID(),
  });
  count = await f.fire('/warehouse/counts', count, 'start');
  expect(count.status).toBe('counting');
  const baseline = (
    await (await f.admin.fetch(`/warehouse/counts/${count.id}`)).json()
  ).data;
  expect(baseline.lines[0].baselineQuantity).toBe('14');
  const blocked = await f.doc({
    ...f.header,
    kind: 'initial',
    initializationReference: randomUUID(),
    lines: [
      {
        id: randomUUID(),
        selection: f.line('1').selection,
        quality: 'qualified',
        notes: '',
      },
    ],
  });
  expect(
    (
      await send(
        f.admin,
        `/warehouse/documents/${blocked.id}/post`,
        mutation(blocked),
      )
    ).status,
  ).toBe(400);
  await f.initial('1', destination.id);
  expect((await f.balance(destination.id))?.quantity).toBe('5');
  const save = await send(
    f.admin,
    `/warehouse/counts/${count.id}`,
    {
      ...mutation(count),
      content: {
        ...f.header,
        lines: baseline.lines.map(
          (line: { id: string; skuId: string; quality: string }) => ({
            id: line.id,
            skuId: line.skuId,
            quality: line.quality,
            actualQuantity: '12',
            reason: 'Two units damaged before count',
            notes: '',
          }),
        ),
      },
    },
    'PATCH',
  );
  expect(save.status).toBe(200);
  count = (await save.json()).data;
  count = await f.fire('/warehouse/counts', count, 'submit');
  expect(
    (
      await send(
        f.admin,
        `/warehouse/counts/${count.id}/approve`,
        mutation(count),
      )
    ).status,
  ).toBe(403);
  const records = testApp.application.container.resolve(executionRecordsToken),
    audit = records.audit.bind(records);
  vi.spyOn(records, 'audit').mockImplementation(async (...args) => {
    if (args[1] === 'stockCounts' && args[4] === 'approve')
      throw new Error('Injected final count audit failure');
    return audit(...args);
  });
  expect(
    (
      await send(
        f.reviewer.session,
        `/warehouse/counts/${count.id}/approve`,
        mutation(count),
      )
    ).status,
  ).toBe(500);
  vi.restoreAllMocks();
  expect((await f.balance())?.quantity).toBe('14');
  expect(
    (
      await database
        .repository('warehouseStockGates')
        .findOne({ filter: { id: String(f.warehouse.id) } })
    )?.countId,
  ).toBe(count.id);
  await f.fire('/warehouse/counts', count, 'approve', f.reviewer.session);
  expect((await f.balance())?.quantity).toBe('12');
  expect(
    (
      await database
        .repository('warehouseStockGates')
        .findOne({ filter: { id: String(f.warehouse.id) } })
    )?.countId,
  ).toBeNull();
  const reconciliation = await f.admin.fetch(
    `/warehouse/inventory/reconcile?subjectId=${f.a.id}`,
  );
  expect(reconciliation.status).toBe(200);
  expect(
    (await reconciliation.json()).data.every(
      (row: { consistent: boolean }) => row.consistent,
    ),
  ).toBe(true);
});
test('master deactivation cannot strand a balance, reserved source or open order, while immutable zero-balance warehouse history remains', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database),
    empty = await f.create('/materials/warehouses', {
      name: 'Retirable isolated warehouse',
      subjectId: f.a.id,
    }),
    initial = await f.initial('2');
  const retire = (row: { id: string; version: number }) =>
    send(f.admin, `/materials/warehouses/${row.id}/deactivate`, {
      version: row.version,
      reason: 'Verify actual dependency coordination',
      requestKey: randomUUID(),
    });
  const blocked = await retire(f.warehouse);
  expect(blocked.status).toBe(400);
  expect((await blocked.json()).error.reason).toBe('STOCK_MASTER_IN_USE');
  expect((await retire(empty)).status).toBe(200);
  const posting = await database
      .repository('stockPostings')
      .findOne({ filter: { documentId: initial.id } }),
    inverse = await f.doc({
      ...f.header,
      kind: 'reversal',
      originalDocumentId: initial.id,
      originalPostingId: posting!.id,
      evidence: 'Reset exact initial fact',
    });
  await f.fire('/warehouse/documents', inverse, 'post');
  expect((await retire(f.warehouse)).status).toBe(200);
  expect(
    await database
      .repository('stockMovements')
      .count({ filter: { subjectId: String(f.a.id) } }),
  ).toBe(2);
});
test('single-reference labels obey company scope and count approval excludes every counter while a metadata-only edit preserves eligibility', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  await f.initial('2');
  await f.grant(f.agent.user.id, 'warehouse.counts', ['read', 'update']);
  await f.grant(f.reviewer.user.id, 'warehouse.counts', ['read', 'update']);
  await f.grant(f.applicant.user.id, 'warehouse.counts', [
    'read',
    'update',
    'review',
    'submit',
  ]);
  await f.orderRules('stockCounts', [f.reviewer.user.id, f.applicant.user.id]);
  const label = await f.applicant.session.fetch(
    `/warehouse/counts/companies/${f.a.id}`,
  );
  expect(label.status).toBe(200);
  expect((await label.json()).data.name).toBe(f.a.name);
  const foreign = await f.create('/materials/warehouses', {
    name: 'Foreign isolated label',
    subjectId: f.b.id,
  });
  expect(
    (
      await f.applicant.session.fetch(
        `/warehouse/counts/warehouses/${foreign.id}?subjectId=${f.b.id}`,
      )
    ).status,
  ).toBe(404);
  let count = await f.create('/warehouse/counts', {
    content: f.header,
    requestKey: randomUUID(),
  });
  count = await f.fire('/warehouse/counts', count, 'start');
  const counting = await f.applicant.session.fetch(
    `/warehouse/counts/${count.id}/capabilities`,
  );
  expect(counting.status).toBe(200);
  expect((await counting.json()).data.actions.submit).toMatchObject({
    visible: true,
  });
  const edit = async (
    session: typeof f.admin,
    actualQuantity: string,
    notes = '',
  ) => {
    const current = (
        await (await f.admin.fetch(`/warehouse/counts/${count.id}`)).json()
      ).data,
      response = await send(
        session,
        `/warehouse/counts/${count.id}`,
        {
          ...mutation(current),
          content: {
            ...f.header,
            notes,
            lines: current.lines.map(
              (line: { id: string; skuId: string; quality: string }) => ({
                id: line.id,
                skuId: line.skuId,
                quality: line.quality,
                actualQuantity,
                reason: 'Observed actual count',
                notes: '',
              }),
            ),
          },
        },
        'PATCH',
      );
    expect(response.status).toBe(200);
    count = (await response.json()).data;
  };
  await edit(f.reviewer.session, '3');
  await edit(f.agent.session, '2');
  await edit(f.applicant.session, '2', 'Metadata-only note');
  const stored = await database
    .repository('stockCounts')
    .findOne({ filter: { id: count.id } });
  expect(stored?.countedActors).toContain(f.reviewer.user.id);
  expect(stored?.countedActors).toContain(f.agent.user.id);
  expect(stored?.countedActors).not.toContain(f.applicant.user.id);
  count = await f.fire('/warehouse/counts', count, 'submit');
  expect(
    (
      await send(
        f.reviewer.session,
        `/warehouse/counts/${count.id}/approve`,
        mutation(count),
      )
    ).status,
  ).toBe(403);
  await f.fire('/warehouse/counts', count, 'approve', f.applicant.session);
  expect((await f.balance())?.quantity).toBe('2');
});
test('inventory reads keep huge decimal ordering exact, exclude inspection/transit from availability, retain base units and enforce dimension scopes', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  await database.repository('measureUnits').updateOne({
    filter: { id: String(f.m.each.id) },
    values: { precision: 6 },
  });
  await f.initial('9007199254740993.000001');
  const inspection = await f.doc({
    ...f.header,
    kind: 'initial',
    initializationReference: randomUUID(),
    lines: [
      {
        id: randomUUID(),
        selection: f.line('9007199254740993.000002').selection,
        quality: 'inspection',
        notes: '',
      },
    ],
  });
  await f.fire('/warehouse/documents', inspection, 'post');
  await f.grant(f.applicant.user.id, 'warehouse.inventory', ['read']);
  const response = await f.applicant.session.fetch(
      `/warehouse/inventory?subjectId=${f.a.id}&orderBy=quantity`,
    ),
    body = await response.json();
  expect(response.status).toBe(200);
  expect(body.data.map((row: { quantity: string }) => row.quantity)).toEqual([
    '9007199254740993.000001',
    '9007199254740993.000002',
  ]);
  expect(body.data[0].available).toBe('9007199254740993.000001');
  expect(body.data[1].available).toBe('0');
  expect(body).not.toHaveProperty('totalQuantity');
  const balance = await f.applicant.session.fetch(
    `/warehouse/inventory/balances/${body.data[0].id}`,
  );
  expect(balance.status).toBe(200);
  expect((await balance.json()).data.material.baseUnitName).toBeTruthy();
  const movements = await f.applicant.session.fetch(
      `/warehouse/inventory/movements?subjectId=${f.a.id}&orderBy=-deltaQuantity`,
    ),
    facts = await movements.json();
  expect(movements.status).toBe(200);
  expect(facts.data[0].deltaQuantity).toBe('9007199254740993.000002');
  expect(facts.data[0].material.baseUnitName).toBeTruthy();
  expect(facts.data[0].warehouse.name).toBe(f.warehouse.name);
  const noMatches = await f.applicant.session.fetch(
    `/warehouse/inventory/movements?subjectId=${f.a.id}&q=no-such-business-source`,
  );
  expect((await noMatches.json()).meta.total).toBe(0);
  const withinDay = await f.applicant.session.fetch(
    `/warehouse/inventory/movements?subjectId=${f.a.id}&from=${facts.meta.businessDate}&to=${facts.meta.businessDate}`,
  );
  expect((await withinDay.json()).meta.total).toBe(2);
  expect(
    (
      await f.applicant.session.fetch(
        `/warehouse/inventory/movements?subjectId=${f.a.id}&orderBy=quantity`,
      )
    ).status,
  ).toBe(400);
  const destination = await f.create('/materials/warehouses', {
    subjectId: f.a.id,
    name: 'Availability destination',
  });
  await f.orderRules('stockTransfers');
  const transferContent = {
    ...f.header,
    destinationWarehouseId: destination.id,
    lines: [{ id: randomUUID(), selection: f.line('3').selection, notes: '' }],
  };
  let transfer = await f.create('/warehouse/transfers', {
    content: transferContent,
    requestKey: randomUUID(),
  });
  transfer = await f.fire('/warehouse/transfers', transfer, 'submit');
  transfer = await f.fire(
    '/warehouse/transfers',
    transfer,
    'approve',
    f.reviewer.session,
  );
  const dispatch = await f.doc({
    ...f.header,
    kind: 'transferDispatch',
    transferId: transfer.id,
    lines: [
      {
        id: randomUUID(),
        transferLineId: transferContent.lines[0].id,
        quantity: '1',
        notes: '',
      },
    ],
  });
  await f.fire('/warehouse/documents', dispatch, 'post');
  const transit = await f.applicant.session.fetch(
    `/warehouse/inventory?subjectId=${f.a.id}&transferId=${transfer.id}`,
  );
  expect((await transit.json()).data[0]).toMatchObject({
    warehouseId: null,
    quantity: '1',
    available: '0',
  });
});
test('loss outbound needs loss evidence and independent review, then reduces only qualified stock and records its movement', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  await f.initial('10');
  expect((await f.balance())?.quantity).toBe('10');
  const lossLine = randomUUID(),
    content = {
      ...f.header,
      kind: 'loss',
      lossEvidence: 'Water damage found during the isolated warehouse review',
      lines: [
        {
          id: lossLine,
          selection: f.line('3').selection,
          quality: 'qualified',
          notes: 'Damaged cartons',
        },
      ],
    };
  const undocumented = await send(f.admin, '/warehouse/documents', {
    content: {
      ...f.header,
      kind: 'loss',
      lines: content.lines,
    },
    requestKey: randomUUID(),
  });
  expect(undocumented.status).toBe(400);
  expect((await undocumented.json()).error.reason).toBe('INVALID_INPUT');
  let loss = await f.doc(content);
  const unreviewed = await send(
    f.admin,
    `/warehouse/documents/${loss.id}/submit`,
    mutation(loss),
  );
  expect(unreviewed.status).toBe(400);
  expect((await unreviewed.json()).error.reason).toBe('STOCK_REVIEWERS_EMPTY');
  await f.orderRules('stockDocuments');
  loss = await f.fire('/warehouse/documents', loss, 'submit');
  expect(loss.status).toBe('pending');
  const early = await send(
    f.admin,
    `/warehouse/documents/${loss.id}/post`,
    mutation(loss),
  );
  expect(early.status).toBe(400);
  expect((await early.json()).error.reason).toBe('STOCK_NOT_APPROVED');
  expect((await f.balance())?.quantity).toBe('10');
  loss = await f.fire(
    '/warehouse/documents',
    loss,
    'approve',
    f.reviewer.session,
  );
  expect(loss.status).toBe('approved');
  loss = await f.fire('/warehouse/documents', loss, 'post');
  expect(loss.status).toBe('posted');
  expect((await f.balance())?.quantity).toBe('7');
  expect(
    await database
      .repository('stockMovements')
      .findOne({ filter: { documentId: loss.id } }),
  ).toMatchObject({
    documentLineId: lossLine,
    quality: 'qualified',
    deltaQuantity: '-3',
  });
  expect(
    await database
      .repository('stockDocuments')
      .findOne({ filter: { id: loss.id } }),
  ).toMatchObject({
    kind: 'loss',
    status: 'posted',
    lossEvidence: 'Water damage found during the isolated warehouse review',
  });
});
test('reversal posts straight from draft without review, restores a posted loss balance, and rejects a duplicate reversal', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  await f.initial('5');
  await f.orderRules('stockDocuments');
  const lossLine = randomUUID();
  let loss = await f.doc({
    ...f.header,
    kind: 'loss',
    lossEvidence: 'Loss posted before its correction',
    lines: [
      {
        id: lossLine,
        selection: f.line('2').selection,
        quality: 'qualified',
        notes: '',
      },
    ],
  });
  loss = await f.fire('/warehouse/documents', loss, 'submit');
  loss = await f.fire(
    '/warehouse/documents',
    loss,
    'approve',
    f.reviewer.session,
  );
  await f.fire('/warehouse/documents', loss, 'post');
  expect((await f.balance())?.quantity).toBe('3');
  const posting = await database
    .repository('stockPostings')
    .findOne({ filter: { documentId: loss.id } });
  expect(posting).toBeTruthy();
  const reversal = await f.doc({
      ...f.header,
      kind: 'reversal',
      originalDocumentId: loss.id,
      originalPostingId: posting!.id,
      evidence: 'The loss was booked against the wrong batch',
    }),
    reversalLine = reversal.lines[0];
  expect(reversal.status).toBe('draft');
  expect(reversalLine).toMatchObject({
    originalDocumentId: loss.id,
    originalLineId: lossLine,
    quantity: '2',
    baseQuantity: '2',
    quality: 'qualified',
  });
  const submit = await send(
    f.admin,
    `/warehouse/documents/${reversal.id}/submit`,
    mutation(reversal),
  );
  expect(submit.status).toBe(400);
  expect((await submit.json()).error).toMatchObject({
    status: 'FAILED_PRECONDITION',
    reason: 'STOCK_REVIEW_NOT_REQUIRED',
  });
  const approve = await send(
    f.admin,
    `/warehouse/documents/${reversal.id}/approve`,
    mutation(reversal),
  );
  expect(approve.status).toBe(400);
  expect((await approve.json()).error).toMatchObject({
    status: 'FAILED_PRECONDITION',
    reason: 'INVALID_STATE',
  });
  const posted = await f.fire('/warehouse/documents', reversal, 'post');
  expect(posted.status).toBe('posted');
  expect((await f.balance())?.quantity).toBe('5');
  expect(
    await database
      .repository('stockMovements')
      .findOne({ filter: { documentId: reversal.id } }),
  ).toMatchObject({
    documentLineId: reversalLine.id,
    quality: 'qualified',
    deltaQuantity: '2',
  });
  expect(
    (
      await database
        .repository('stockDocuments')
        .findOne({ filter: { id: loss.id } })
    )?.status,
  ).toBe('posted');
  const related = await send(
    f.admin,
    `/warehouse/documents?subjectId=${f.a.id}&originalDocumentId=${loss.id}&pageSize=10`,
    undefined,
    'GET',
  );
  expect(related.status).toBe(200);
  expect(
    (await related.json()).data.map((row: { id: string }) => row.id),
  ).toContain(reversal.id);
  const duplicate = await send(f.admin, '/warehouse/documents', {
    content: {
      ...f.header,
      kind: 'reversal',
      originalDocumentId: loss.id,
      originalPostingId: posting!.id,
      evidence: 'A posting can only be reversed once',
    },
    requestKey: randomUUID(),
  });
  expect(duplicate.status).toBe(400);
  expect((await duplicate.json()).error.reason).toBe('STOCK_ALREADY_REVERSED');
});
test('transfer discrepancy is independently reviewed, consumes the remaining in-transit stock, and records received 6 with discrepancy 4', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database),
    destination = await f.create('/materials/warehouses', {
      name: 'Discrepancy destination',
      subjectId: f.a.id,
    });
  await f.initial('10');
  await f.orderRules('stockTransfers');
  const transferLine = randomUUID(),
    transferContent = {
      ...f.header,
      destinationWarehouseId: destination.id,
      lines: [
        { id: transferLine, selection: f.line('10').selection, notes: '' },
      ],
    };
  let transfer = await f.create('/warehouse/transfers', {
    content: transferContent,
    requestKey: randomUUID(),
  });
  transfer = await f.fire('/warehouse/transfers', transfer, 'submit');
  transfer = await f.fire(
    '/warehouse/transfers',
    transfer,
    'approve',
    f.reviewer.session,
  );
  const dispatch = await f.doc({
    ...f.header,
    kind: 'transferDispatch',
    transferId: transfer.id,
    lines: [
      {
        id: randomUUID(),
        transferLineId: transferLine,
        quantity: '10',
        notes: '',
      },
    ],
  });
  await f.fire('/warehouse/documents', dispatch, 'post');
  const receive = await f.doc({
    ...f.header,
    warehouseId: destination.id,
    kind: 'transferReceipt',
    transferId: transfer.id,
    lines: [
      {
        id: randomUUID(),
        transferLineId: transferLine,
        quantity: '6',
        notes: '',
      },
    ],
  });
  await f.fire('/warehouse/documents', receive, 'post');
  expect((await f.balance(destination.id))?.quantity).toBe('6');
  await f.orderRules('stockDocuments');
  let discrepancy = await f.doc({
    ...f.header,
    warehouseId: destination.id,
    kind: 'transferDiscrepancy',
    transferId: transfer.id,
    evidence: 'Four of ten dispatched units never arrived',
    lines: [
      {
        id: randomUUID(),
        transferLineId: transferLine,
        quantity: '4',
        notes: '',
      },
    ],
  });
  expect(discrepancy.status).toBe('draft');
  discrepancy = await f.fire('/warehouse/documents', discrepancy, 'submit');
  expect(discrepancy.status).toBe('pending');
  discrepancy = await f.fire(
    '/warehouse/documents',
    discrepancy,
    'approve',
    f.reviewer.session,
  );
  expect(discrepancy.status).toBe('approved');
  discrepancy = await f.fire('/warehouse/documents', discrepancy, 'post');
  expect(discrepancy.status).toBe('posted');
  expect(
    await database
      .repository('stockBalances')
      .findOne({ filter: { transferId: transfer.id } }),
  ).toMatchObject({ quantity: '0', warehouseId: null });
  expect((await f.balance())?.quantity).toBe('0');
  expect((await f.balance(destination.id))?.quantity).toBe('6');
  const detail = await f.admin.fetch(`/warehouse/transfers/${transfer.id}`);
  expect(detail.status).toBe(200);
  expect((await detail.json()).data.lines[0]).toMatchObject({
    dispatchedQuantity: '10',
    receivedQuantity: '6',
    discrepancyQuantity: '4',
  });
  const movements = await database
    .repository('stockMovements')
    .findMany({ filter: { documentId: discrepancy.id } });
  expect(movements).toHaveLength(1);
  expect(movements[0]).toMatchObject({
    deltaQuantity: '-4',
    transferId: transfer.id,
    warehouseId: null,
  });
});

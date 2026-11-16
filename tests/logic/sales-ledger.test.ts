// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import { createStandaloneServer } from '../../server/standalone.js';
import { executionFixture } from '../helpers/execution.js';
import { mutation, send } from '../helpers/purchase-requests.js';
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
    header = {
      subjectId: f.a.id,
      warehouseId: f.warehouse.id,
      occurredOn: '2026-11-01',
      reason: 'Sales ledger verification',
      notes: '',
    },
    doc = async (content: unknown) =>
      f.create('/warehouse/documents', { content, requestKey: randomUUID() }),
    fire = async (
      base: string,
      row: { id: string; revision: number; lifecycleVersion: number },
      action: string,
      session = f.admin,
    ) => {
      const response = await send(
        session,
        `${base}/${row.id}/${action}`,
        mutation(row),
      );
      const body = await response.json();
      if (response.status !== 200)
        throw new Error(
          `${action} failed: ${JSON.stringify(body.error ?? body)}`,
        );
      return body.data as typeof row & Record<string, unknown>;
    },
    initial = async (quantity: string) => {
      const row = await doc({
        ...header,
        kind: 'initial',
        initializationReference: `ledger-initial-${randomUUID()}`,
        notes: 'Sales ledger opening stock',
        lines: [
          {
            id: randomUUID(),
            selection: f.line(quantity).selection,
            quality: 'qualified',
            notes: '',
          },
        ],
      });
      return fire('/warehouse/documents', row, 'post');
    };
  for (const resource of ['sales.orders', 'warehouse.documents'])
    await f.grant(f.reviewer.user.id, resource, ['read', 'review']);
  const customer = await send(f.admin, '/sales/customerRoles', {
    partnerId: f.supplier.partnerId,
    subjectId: f.a.id,
    requestKey: randomUUID(),
  });
  if (customer.status !== 201)
    throw new Error(`customer role failed: ${customer.status}`);
  return { ...f, header, doc, fire, initial };
};

test('customer price lists enforce the company, unique key and disable lifecycle', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  const input = {
    subjectId: f.a.id,
    customerId: f.supplier.partnerId,
    skuId: f.m.sku.id,
    unitPrice: '19.90',
    currency: 'CNY',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    note: 'Annual price',
    requestKey: randomUUID(),
  };
  const created = await send(f.admin, '/sales/price-lists', input);
  const createdBody = await created.json();
  expect(created.status, JSON.stringify(createdBody)).toBe(201);
  const price = createdBody.data;
  expect(price).toMatchObject({
    customerId: f.supplier.partnerId,
    skuId: f.m.sku.id,
    unitPrice: '19.9',
    currency: 'CNY',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    status: 'active',
    customer: { id: f.supplier.partnerId },
    sku: { id: f.m.sku.id },
  });
  const list = await f.admin.fetch(`/sales/price-lists?subjectId=${f.a.id}`);
  expect(list.status).toBe(200);
  expect((await list.json()).data).toHaveLength(1);
  const duplicate = await send(f.admin, '/sales/price-lists', {
    ...input,
    unitPrice: '20.00',
    requestKey: randomUUID(),
  });
  expect(duplicate.status).toBe(409);
  const updated = await send(
    f.admin,
    `/sales/price-lists/${price.id}`,
    { unitPrice: '21.50', requestKey: randomUUID() },
    'PATCH',
  );
  expect(updated.status).toBe(200);
  expect((await updated.json()).data.unitPrice).toBe('21.5');
  const disabled = await send(
    f.admin,
    `/sales/price-lists/${price.id}/disable`,
    { requestKey: randomUUID() },
  );
  expect(disabled.status).toBe(200);
  expect((await disabled.json()).data.status).toBe('inactive');
});

test('a posted shipment creates the receivable and collections move it from open to paid', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  await f.initial('10');
  await f.orderRules('salesOrders');
  const content = f.orderContent('6');
  delete content.demandMode;
  delete content.temporaryReason;
  content.lines[0].unitPrice = '19.90';
  let order = await f.create('/sales/orders', {
    content,
    requestKey: randomUUID(),
  });
  order = await f.fire('/sales/orders', order, 'submit');
  order = await f.fire('/sales/orders', order, 'approve', f.reviewer.session);
  const line = content.lines[0];
  expect(
    (
      await database.repository('salesOrderLines').findOne({
        filter: { id: line.id },
      })
    )?.amount,
  ).toBe('119.4');
  const shipment = await f.doc({
    ...f.header,
    kind: 'salesShipment',
    salesOrderId: order.id,
    lines: [
      {
        id: randomUUID(),
        salesOrderLineId: line.id,
        quantity: '4',
        notes: '',
      },
    ],
  });
  await f.fire('/warehouse/documents', shipment, 'post');
  const listed = await f.admin.fetch(`/sales/receivables?subjectId=${f.a.id}`);
  const listedBody = await listed.json();
  expect(listed.status, JSON.stringify(listedBody)).toBe(200);
  const page = listedBody;
  expect(page.data).toHaveLength(1);
  const receivable = page.data[0];
  expect(receivable).toMatchObject({
    orderId: order.id,
    orderLineId: line.id,
    documentId: shipment.id,
    amount: '79.6',
    paidAmount: '0',
    outstanding: '79.6',
    status: 'open',
    priced: true,
  });
  expect(receivable.customer).toMatchObject({
    id: f.supplier.partnerId,
  });
  const detail = await f.admin.fetch(`/sales/receivables/${receivable.id}`);
  expect(detail.status).toBe(200);
  expect((await detail.json()).data.payments).toEqual([]);
  const partial = await send(
    f.admin,
    `/sales/receivables/${receivable.id}/payments`,
    {
      amount: '30.00',
      paidAt: '2026-11-02',
      method: 'bank_transfer',
      reference: 'BANK-1',
      note: 'First installment',
      requestKey: randomUUID(),
    },
  );
  expect(partial.status).toBe(201);
  expect((await partial.json()).data).toMatchObject({
    status: 'partially_paid',
    amount: '79.6',
    paidAmount: '30',
    outstanding: '49.6',
    payment: { amount: '30', method: 'bank_transfer' },
  });
  const rest = await send(
    f.admin,
    `/sales/receivables/${receivable.id}/payments`,
    {
      amount: '49.60',
      paidAt: '2026-11-03',
      method: 'cash',
      requestKey: randomUUID(),
    },
  );
  expect(rest.status).toBe(201);
  expect((await rest.json()).data).toMatchObject({
    status: 'paid',
    paidAmount: '79.6',
    outstanding: '0',
  });
  const over = await send(
    f.admin,
    `/sales/receivables/${receivable.id}/payments`,
    {
      amount: '0.01',
      paidAt: '2026-11-04',
      method: 'cash',
      requestKey: randomUUID(),
    },
  );
  expect(over.status).toBe(400);
  expect((await over.json()).error.reason).toBe('SALES_PAYMENT_EXCEEDS');
  const zero = await send(
    f.admin,
    `/sales/receivables/${receivable.id}/payments`,
    {
      amount: '0',
      paidAt: '2026-11-04',
      method: 'cash',
      requestKey: randomUUID(),
    },
  );
  expect(zero.status).toBe(400);
  const paid = await f.admin.fetch(
    `/sales/receivables?subjectId=${f.a.id}&status=paid`,
  );
  expect(paid.status).toBe(200);
  expect((await paid.json()).data).toHaveLength(1);

  // A second shipment reverses its own receivable, while the earlier paid
  // receivable is untouched.
  const second = await f.doc({
    ...f.header,
    kind: 'salesShipment',
    salesOrderId: order.id,
    lines: [
      {
        id: randomUUID(),
        salesOrderLineId: line.id,
        quantity: '2',
        notes: '',
      },
    ],
  });
  await f.fire('/warehouse/documents', second, 'post');
  const posting = await database
    .repository('stockPostings')
    .findOne({ filter: { documentId: second.id } });
  expect(posting).toBeTruthy();
  const reversal = await f.doc({
    ...f.header,
    kind: 'reversal',
    originalDocumentId: second.id,
    originalPostingId: posting!.id,
    evidence: 'Shipment entered against the wrong order',
  });
  await f.fire('/warehouse/documents', reversal, 'post');
  const secondReceivable = await database
    .repository('salesReceivables')
    .findOne({ filter: { documentId: second.id } });
  expect(secondReceivable?.status).toBe('void');
  const firstReceivable = await database
    .repository('salesReceivables')
    .findOne({ filter: { documentId: shipment.id } });
  expect(firstReceivable?.status).toBe('paid');
});

test('the ledger obeys the company scope of the sales-order grant', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  const outsider = await f.person('Ledger scoped user');
  await f.grant(outsider.user.id, 'sales.orders', ['read', 'update'], [f.a.id]);
  expect(
    (
      await send(outsider.session, '/sales/price-lists', {
        subjectId: f.a.id,
        customerId: f.supplier.partnerId,
        skuId: f.m.sku.id,
        unitPrice: '1.00',
        currency: 'CNY',
        effectiveFrom: '2026-01-01',
        requestKey: randomUUID(),
      })
    ).status,
  ).toBe(201);
  expect(
    (await outsider.session.fetch(`/sales/price-lists?subjectId=${f.b.id}`))
      .status,
  ).toBe(403);
  expect(
    (await outsider.session.fetch(`/sales/receivables?subjectId=${f.b.id}`))
      .status,
  ).toBe(403);
  expect(
    (await outsider.session.fetch(`/sales/receivables?subjectId=${f.a.id}`))
      .status,
  ).toBe(200);
});

test('a sales return reduces the receivable in proportion to the returned quantity', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database);
  await f.initial('10');
  await f.orderRules('salesOrders');
  const content = f.orderContent('6');
  delete content.demandMode;
  delete content.temporaryReason;
  content.lines[0].unitPrice = '19.90';
  let order = await f.create('/sales/orders', {
    content,
    requestKey: randomUUID(),
  });
  order = await f.fire('/sales/orders', order, 'submit');
  order = await f.fire('/sales/orders', order, 'approve', f.reviewer.session);
  const line = content.lines[0];
  const shipment = await f.doc({
    ...f.header,
    kind: 'salesShipment',
    salesOrderId: order.id,
    lines: [
      {
        id: randomUUID(),
        salesOrderLineId: line.id,
        quantity: '4',
        notes: '',
      },
    ],
  });
  await f.fire('/warehouse/documents', shipment, 'post');
  const receivable = async () => {
    const response = await f.admin.fetch(
      `/sales/receivables?subjectId=${f.a.id}&documentId=${shipment.id}`,
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { data: Record<string, unknown>[] })
      .data[0];
  };
  expect((await receivable()).amount).toBe('79.6');
  const sendBack = async (quantity: string) => {
    const row = await f.doc({
      ...f.header,
      kind: 'salesReturn',
      originalDocumentId: shipment.id,
      lines: [
        {
          id: randomUUID(),
          originalLineId: shipment.lines[0].id,
          quantity,
          condition: 'Packaging damaged, inspection required',
          notes: '',
        },
      ],
    });
    await f.fire('/warehouse/documents', row, 'post');
  };
  await sendBack('1');
  expect((await receivable()).amount).toBe('59.7');
  await sendBack('3');
  const cleared = await receivable();
  expect(cleared.amount).toBe('0');
  expect(cleared.status).toBe('void');
  expect(cleared.outstanding).toBe('0');
});

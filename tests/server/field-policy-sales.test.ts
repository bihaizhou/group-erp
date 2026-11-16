// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import { createStandaloneServer } from '../../server/standalone.js';
import { executionFixture } from '../helpers/execution.js';
import { send } from '../helpers/purchase-requests.js';

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

type Customer = {
  id: string;
  partnerId: string;
  identity: {
    id: string;
    code: string;
    name: string;
    registrationCode: string | null;
    revision: number;
  };
};

test('customer field policies redact hidden identity fields and reject hidden writes', async ({
  testApp,
  database,
}) => {
  const f = await executionFixture(testApp, database);
  const suffix = randomUUID().slice(0, 8);
  const registrationCode = `9131${suffix}`.toUpperCase();
  const customer = (await f.create('/sales/customers', {
    subjectId: f.a.id,
    code: `C-${suffix}`,
    name: 'Policy customer',
    registrationCode,
    notes: 'Customer notes',
    requestKey: randomUUID(),
  })) as Customer;
  expect(customer.identity.registrationCode).toBe(registrationCode);

  const key = `fp-sales-customer-${suffix}`;
  await f.authz.permissionSets.create({ key, grants: [] });
  const user = await f.person('Customer policy user');
  await f.grant(user.user.id, 'sales.customers', [
    'read',
    'create',
    'updateIdentity',
    'updateRelationship',
  ]);
  await f.authz.permissionSets.assign({
    permissionSet: key,
    subject: { type: 'user', id: user.user.id },
  });
  const saved = await f.admin.fetch(
    '/field-policies',
    json({
      permissionSetKey: key,
      requestKey: randomUUID(),
      policies: [
        { resource: 'sales.customer', field: 'code', access: 'write' },
        { resource: 'sales.customer', field: 'name', access: 'write' },
        {
          resource: 'sales.customer',
          field: 'registrationCode',
          access: 'hidden',
        },
        { resource: 'sales.customer', field: 'status', access: 'write' },
      ],
    }),
  );
  expect(saved.status).toBe(200);

  const list = await user.session.fetch(`/sales/customers?subjectId=${f.a.id}`);
  expect(list.status).toBe(200);
  const row = (await list.json()).data.find(
    (candidate: { id: string }) => candidate.id === customer.id,
  );
  expect(row).toBeTruthy();
  expect(row.identity).not.toHaveProperty('registrationCode');
  expect(row.identity).toMatchObject({
    code: customer.identity.code,
    name: customer.identity.name,
  });

  const detail = await user.session.fetch(`/sales/customers/${customer.id}`);
  expect(detail.status).toBe(200);
  const detailBody = await detail.json();
  expect(detailBody.data.identity).not.toHaveProperty('registrationCode');
  expect(detailBody.data.identity).toMatchObject({
    code: customer.identity.code,
    name: customer.identity.name,
  });

  const rejectedCreate = await send(user.session, '/sales/customers', {
    subjectId: f.a.id,
    code: `C-HIDDEN-${suffix}`,
    name: 'Hidden registration customer',
    registrationCode: '91310000HIDDEN',
    notes: '',
    requestKey: randomUUID(),
  });
  expect(rejectedCreate.status).toBe(403);
  expect(await rejectedCreate.text()).toContain('FIELD_NOT_WRITABLE');

  const allowed = await send(
    user.session,
    `/sales/customerIdentities/${customer.identity.id}`,
    {
      version: customer.identity.revision,
      reason: 'Field policy verification',
      requestKey: randomUUID(),
      code: customer.identity.code,
      name: 'Renamed policy customer',
      registrationCode,
    },
    'PATCH',
  );
  expect(allowed.status).toBe(200);
  const renamed = (await allowed.json()).data;
  expect(renamed).toMatchObject({ name: 'Renamed policy customer' });
  expect(renamed).not.toHaveProperty('registrationCode');

  const rejectedIdentity = await send(
    user.session,
    `/sales/customerIdentities/${customer.identity.id}`,
    {
      version: renamed.revision,
      reason: 'Field policy verification',
      requestKey: randomUUID(),
      code: renamed.code,
      name: renamed.name,
      registrationCode: '91310000CHANGED',
    },
    'PATCH',
  );
  expect(rejectedIdentity.status).toBe(403);
  expect(await rejectedIdentity.text()).toContain('FIELD_NOT_WRITABLE');

  const plain = await f.person('Plain customer reader');
  await f.grant(plain.user.id, 'sales.customers', ['read']);
  const plainDetail = await plain.session.fetch(
    `/sales/customers/${customer.id}`,
  );
  expect(plainDetail.status).toBe(200);
  const plainBody = await plainDetail.json();
  expect(plainBody.data.identity).toHaveProperty(
    'registrationCode',
    registrationCode,
  );
});

test('sales order line field policies redact hidden prices and reject hidden writes', async ({
  testApp,
  database,
}) => {
  const f = await executionFixture(testApp, database);
  const suffix = randomUUID().slice(0, 8);
  const customer = (await f.create('/sales/customers', {
    subjectId: f.a.id,
    code: `C-ORDER-${suffix}`,
    name: 'Order policy customer',
    notes: '',
    requestKey: randomUUID(),
  })) as Customer;
  await f.orderRules('salesOrders');

  const key = `fp-sales-order-${suffix}`;
  await f.authz.permissionSets.create({ key, grants: [] });
  const user = await f.person('Sales order policy user');
  await f.grant(user.user.id, 'sales.orders', ['read', 'create', 'update']);
  await f.authz.permissionSets.assign({
    permissionSet: key,
    subject: { type: 'user', id: user.user.id },
  });
  const saved = await f.admin.fetch(
    '/field-policies',
    json({
      permissionSetKey: key,
      requestKey: randomUUID(),
      policies: [
        { resource: 'execution.document', field: 'code', access: 'write' },
        {
          resource: 'execution.document',
          field: 'occurredOn',
          access: 'write',
        },
        { resource: 'execution.document', field: 'reason', access: 'write' },
        { resource: 'execution.document', field: 'notes', access: 'write' },
        { resource: 'execution.document', field: 'status', access: 'write' },
        {
          resource: 'execution.document.line',
          field: 'quantity',
          access: 'write',
        },
        {
          resource: 'execution.document.line',
          field: 'quality',
          access: 'write',
        },
        {
          resource: 'execution.document.line',
          field: 'notes',
          access: 'write',
        },
        {
          resource: 'execution.document.line',
          field: 'unitPrice',
          access: 'hidden',
        },
        {
          resource: 'execution.document.line',
          field: 'amount',
          access: 'write',
        },
      ],
    }),
  );
  expect(saved.status).toBe(200);

  const salesContent = (unitPrice: string | null) => {
    const content: Record<string, unknown> = {
      ...f.orderContent('2'),
      partnerId: customer.partnerId,
    };
    delete content.demandMode;
    delete content.temporaryReason;
    const line = {
      ...f.line('2'),
      unitPrice,
    };
    content.lines = [line];
    return { content, line };
  };

  const rejected = await send(user.session, '/sales/orders', {
    content: salesContent('12.5').content,
    requestKey: randomUUID(),
  });
  expect(rejected.status).toBe(403);
  expect(await rejected.text()).toContain('FIELD_NOT_WRITABLE');

  const create = salesContent(null);
  const created = await send(user.session, '/sales/orders', {
    content: create.content,
    requestKey: randomUUID(),
  });
  expect(created.status).toBe(201);
  const order = (await created.json()).data;
  const createdLine = order.lines.find(
    (line: { id: string }) => line.id === create.line.id,
  );
  expect(createdLine).toBeTruthy();
  expect(createdLine).not.toHaveProperty('unitPrice');

  const detail = await user.session.fetch(`/sales/orders/${order.id}`);
  expect(detail.status).toBe(200);
  const detailBody = await detail.json();
  const detailLine = detailBody.data.lines.find(
    (line: { id: string }) => line.id === create.line.id,
  );
  expect(detailLine).toBeTruthy();
  expect(detailLine).not.toHaveProperty('unitPrice');

  const rejectedUpdate = await send(
    user.session,
    `/sales/orders/${order.id}`,
    {
      version: order.revision,
      lifecycleVersion: order.lifecycleVersion,
      reason: 'Field policy verification',
      requestKey: randomUUID(),
      content: {
        ...create.content,
        lines: [{ ...create.line, unitPrice: '13.5' }],
      },
    },
    'PATCH',
  );
  expect(rejectedUpdate.status).toBe(403);
  expect(await rejectedUpdate.text()).toContain('FIELD_NOT_WRITABLE');

  const plain = await f.person('Plain sales order user');
  await f.grant(plain.user.id, 'sales.orders', ['read', 'create']);
  const plainCreate = salesContent('12.5');
  const plainOrderResponse = await send(plain.session, '/sales/orders', {
    content: plainCreate.content,
    requestKey: randomUUID(),
  });
  expect(plainOrderResponse.status).toBe(201);
  const plainOrder = (await plainOrderResponse.json()).data;
  const plainLine = plainOrder.lines.find(
    (line: { id: string }) => line.id === plainCreate.line.id,
  );
  expect(plainLine).toBeTruthy();
  expect(plainLine).toHaveProperty('unitPrice');
  expect(Number(plainLine.unitPrice)).toBe(12.5);

  // A price captured in the selection snapshot before the policy applied must
  // not leak through the nested copy on another company order.
  const adminDetail = await f.admin.fetch(`/sales/orders/${plainOrder.id}`);
  const adminBody = (await adminDetail.json()) as {
    data: { lines: Array<Record<string, unknown>> };
  };
  const adminLine = adminBody.data.lines.find(
    (line) => line.id === plainCreate.line.id,
  );
  expect((adminLine!.selectionInput as Record<string, unknown>).unitPrice).toBe(
    '12.5',
  );
  const nestedDetail = await user.session.fetch(
    `/sales/orders/${plainOrder.id}`,
  );
  expect(nestedDetail.status).toBe(200);
  const nestedBody = (await nestedDetail.json()) as {
    data: { lines: Array<Record<string, unknown>> };
  };
  const nestedLine = nestedBody.data.lines.find(
    (line) => line.id === plainCreate.line.id,
  );
  expect(nestedLine).toBeTruthy();
  expect(nestedLine).not.toHaveProperty('unitPrice');
  expect(
    (nestedLine!.selectionInput as Record<string, unknown>).unitPrice,
  ).toBeUndefined();
});

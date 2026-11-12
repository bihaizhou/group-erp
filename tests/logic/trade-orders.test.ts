// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import { createStandaloneServer } from '../../server/standalone.js';
import { fixture, send, mutation } from '../helpers/purchase-requests.js';
import { executionFixture as setup } from '../helpers/execution.js';
import { executionRecordsToken } from '../../server/providers/execution.js';
import {
  executionColumns,
  executionReferences,
  executionSourceReferences,
} from '../../server/providers/execution-resources.js';
import type { MaterialPolicies } from '../../server/providers/material-service.js';
import {
  apiDocsToken,
  findUndeclaredApiRoutes,
  findApiDocumentSchemaProblems,
} from '@nocobase/app-server/router';

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

test('quantity APIs authenticate before parsing and deny unrelated module grants; every route is documented', async ({
  testApp,
  database,
  request,
}) => {
  for (const path of [
    '/sales/customers',
    '/sales/orders',
    '/procurement/orders',
    '/warehouse/settings',
    '/sales/customerRoles',
  ])
    expect((await request(path)).status).toBe(401);
  const f = await fixture(testApp, database);
  expect(
    (await f.applicant.session.fetch('/procurement/orders?subjectId=' + f.a.id))
      .status,
  ).toBe(403);
  expect(
    (await send(f.applicant.session, '/sales/customerRoles', {})).status,
  ).toBe(403);
  const docs = await testApp.application.container
    .resolve(apiDocsToken)
    .getDocument();
  expect(findUndeclaredApiRoutes(testApp.application)).toEqual([]);
  expect(findApiDocumentSchemaProblems(docs)).toEqual([]);
  expect(
    docs.paths?.['/api/sales/customerIdentities/{id}/applicability/deactivate']
      ?.post?.operationId,
  ).toBe('deactivateSalesCustomerRole');
});

test('one shared identity has independent supplier/customer roles, scope, company notes and global status', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database),
    input = {
      subjectId: f.a.id,
      partnerId: f.supplier.partnerId,
      notes: 'Customer notes',
      requestKey: randomUUID(),
    },
    created = await send(f.admin, '/sales/customerRoles', input);
  expect(created.status).toBe(201);
  const customer = (await created.json()).data;
  expect(customer).toMatchObject({
    partnerId: f.supplier.partnerId,
    partnerRole: 'customer',
    notes: 'Customer notes',
  });
  const candidates = await f.admin.fetch(
      `/sales/customerRoles?q=${encodeURIComponent(f.supplier.identity.code)}`,
    ),
    candidate = (await candidates.json()).data[0];
  expect(candidates.status).toBe(200);
  expect(candidate).toMatchObject({
    id: f.supplier.partnerId,
    available: false,
  });
  expect(Object.keys(candidate).sort()).toEqual([
    'available',
    'code',
    'id',
    'name',
  ]);
  expect((await send(f.admin, '/sales/customerRoles', input)).status).toBe(201);
  expect(
    await database
      .repository('businessPartners')
      .count({ filter: { id: String(f.supplier.partnerId) } }),
  ).toBe(1);
  expect(
    await database
      .repository('partnerRolePolicies')
      .count({ filter: { partnerId: String(f.supplier.partnerId) } }),
  ).toBe(2);
  const policy = (
    await (
      await f.admin.fetch(
        `/sales/customerIdentities/${f.supplier.partnerId}/applicability`,
      )
    ).json()
  ).data;
  const stopped = await send(
    f.admin,
    `/sales/customerIdentities/${f.supplier.partnerId}/applicability/deactivate`,
    {
      version: policy.revision,
      requestKey: randomUUID(),
      reason: 'Suspend customer role only',
    },
  );
  expect(stopped.status).toBe(200);
  const suppliers = await f.admin.fetch(
      `/procurement/supplierOptions?subjectId=${f.a.id}`,
    ),
    customers = await f.admin.fetch(
      `/sales/customerOptions?subjectId=${f.a.id}`,
    );
  expect(
    (await suppliers.json()).data.some(
      (row: { partnerId: string }) => row.partnerId === f.supplier.partnerId,
    ),
  ).toBe(true);
  expect(
    (await customers.json()).data.some(
      (row: { partnerId: string }) => row.partnerId === f.supplier.partnerId,
    ),
  ).toBe(false);
  expect(
    (
      await (
        await f.admin.fetch(`/procurement/suppliers/${f.supplier.id}`)
      ).json()
    ).data.notes,
  ).toBe('Supplier notes');
});

test('approved purchase demand splits into bounded orders; frozen independent review and explicit version conflicts preserve exact allocations', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database),
    base = '/procurement/orders';
  await f.grant(f.applicant.user.id, 'procurement.orders', [
    'read',
    'create',
    'update',
    'submit',
    'review',
    'withdraw',
    'revise',
    'cancel',
    'copy',
    'closeRemainder',
  ]);
  await f.grant(f.reviewer.user.id, 'procurement.orders', ['read', 'review']);
  await f.saveRules();
  let demand = await f.draft(f.m.content);
  demand = await f.fire(demand, 'submit');
  demand = await f.fire(demand, 'approve', f.reviewer.session);
  await f.orderRules('purchaseOrders');
  const content = (quantity: string) => {
    const value = f.orderContent(quantity);
    value.demandMode = 'request';
    value.temporaryReason = null;
    value.lines[0].allocations = [
      {
        requestId: demand.id,
        requestLineId: demand.lines[0].id,
        requestVersionId: demand.approvedVersionId,
        baseQuantity: quantity,
      },
    ];
    return value;
  };
  const input = { content: content('10'), requestKey: randomUUID() };
  input.content.lines[0].unitPrice = '19.90345678';
  const created = await send(f.applicant.session, base, input);
  expect(created.status).toBe(201);
  let order = (await created.json()).data;
  expect(order.lines[0]).toMatchObject({
    quantity: '10',
    baseQuantity: '10',
    fulfilledQuantity: '0',
  });
  expect((await send(f.applicant.session, base, input)).status).toBe(201);
  expect(
    (
      await send(f.applicant.session, base, {
        content: content('14'),
        requestKey: randomUUID(),
      })
    ).status,
  ).toBe(201);
  const excess = await send(f.applicant.session, base, {
    content: content('1'),
    requestKey: randomUUID(),
  });
  expect(excess.status).toBe(400);
  expect((await excess.json()).error.reason).toBe(
    'STOCK_SOURCE_REMAINING_EXCEEDED',
  );
  const beforeSubmit = { ...order };
  order = await f.orderFire(base, order, 'submit');
  const self = await send(
    f.applicant.session,
    `${base}/${order.id}/approve`,
    mutation(order),
  );
  expect(self.status).toBe(403);
  await f.orderRules('purchaseOrders', [f.agent.user.id], 1);
  order = await f.orderFire(base, order, 'approve', f.reviewer.session);
  expect(order.status).toBe('approved');
  const versions = (
    await (
      await f.applicant.session.fetch(`${base}/${order.id}/versions`)
    ).json()
  ).data;
  expect(versions[0].payload.lines[0].baseQuantity).toBe('10');
  const records = testApp.application.container.resolve(executionRecordsToken),
    p: MaterialPolicies = Object.fromEntries(
      Object.keys({
        ...executionReferences,
        ...executionSourceReferences,
        ...executionColumns,
      }).map((name) => [
        name,
        { read: true, create: false, update: false, delete: false },
      ]),
    );
  p.purchaseOrderLines = {
    ...p.purchaseOrderLines,
    read: {
      scope: true,
      fields: executionColumns.purchaseOrderLines.filter(
        (field) => field !== 'unitPrice',
      ),
    },
  };
  const publicView = await records.view(
    database.connection(),
    'purchaseOrders',
    order.id,
    p,
  );
  expect(JSON.stringify(publicView)).not.toContain('19.90345678');
  const maskedVersions = await records.versions(
    'purchaseOrders',
    order.id,
    { page: 1, pageSize: 20 },
    p,
  );
  expect(JSON.stringify(maskedVersions)).not.toContain('19.90345678');
  const context = (
    publicView.review as {
      tasks: {
        parameterSnapshot: {
          values: { reviewerSelections: { referenceId: string }[] };
        };
      }[];
    }
  ).tasks[0];
  expect(
    context.parameterSnapshot.values.reviewerSelections[0].referenceId,
  ).toBe(f.reviewer.user.id);
  await expect(
    database.repository('executionVersions').updateOne({
      filter: { id: versions[0].id },
      values: { payload: { changed: true } },
    }),
  ).rejects.toThrow();
  expect(
    (
      await send(
        f.applicant.session,
        `${base}/${order.id}`,
        { ...mutation(beforeSubmit), content: input.content },
        'PATCH',
      )
    ).status,
  ).toBe(409);
  expect(
    await database
      .repository('purchaseAllocations')
      .count({ filter: { orderId: order.id, status: 'active' } }),
  ).toBe(1);
  expect(
    await database
      .repository('stockPostings')
      .count({ filter: { subjectId: String(f.a.id) } }),
  ).toBe(0);
});

test('a failure after order lines and allocations rolls back the entire creation and request key', async ({
  testApp,
  database,
}) => {
  const f = await setup(testApp, database),
    records = testApp.application.container.resolve(executionRecordsToken),
    spy = vi
      .spyOn(records, 'audit')
      .mockRejectedValueOnce(new Error('Injected order audit failure')),
    input = { content: f.orderContent(), requestKey: randomUUID() },
    result = await send(f.admin, '/procurement/orders', input);
  expect(result.status).toBe(500);
  spy.mockRestore();
  expect(
    await database
      .repository('purchaseOrders')
      .count({ filter: { subjectId: String(f.a.id) } }),
  ).toBe(0);
  expect(
    await database
      .repository('purchaseOrderLines')
      .count({ filter: { subjectId: String(f.a.id) } }),
  ).toBe(0);
  expect(
    await database.repository('executionActionRequests').count({
      filter: { actorId: f.admin.user.id, requestKey: input.requestKey },
    }),
  ).toBe(0);
  expect((await send(f.admin, '/procurement/orders', input)).status).toBe(201);
});

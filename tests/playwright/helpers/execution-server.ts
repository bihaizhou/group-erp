import path from 'node:path';
import { mkdir, writeFile, unlink, access } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createTestApp } from '@nocobase/app-testing/server';
import { startNodeAppServer, closeNodeServer } from '@nocobase/app-server/node';
import { DEFAULT_ADMIN_CREDENTIALS } from '@nocobase/app-plugin-authentication/testing';
import { createStandaloneServer } from '../../../server/standalone.js';
import {
  fixture,
  purchaseMaterial,
  send,
  mutation,
} from '../../helpers/purchase-requests.js';
const root = path.resolve(import.meta.dirname, '../../..'),
  dir = path.join(root, 'storage/ui-workflow/inventory'),
  origin = 'http://127.0.0.1:14036';
await mkdir(dir, { recursive: true });
await unlink(path.join(dir, 'stop-fixture')).catch(() => undefined);
const app = await createTestApp({
  createServer: createStandaloneServer,
  server: {
    env: {
      NODE_ENV: 'test',
      APP_PUBLIC_ORIGIN: origin,
      APP_BASE_PATH: '/main',
    },
    viteDevUrl: false,
    paths: { rootDir: root, clientDir: path.join(root, 'dist/client') },
  },
  config: {
    app: { publicOrigin: origin },
    i18n: { defaultLocale: 'zh-CN' },
    users: { initialAdmin: DEFAULT_ADMIN_CREDENTIALS },
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    jobs: { default: 'memory' },
    queue: { default: 'memory' },
    logging: { console: { enabled: false }, file: { enabled: false } },
  },
});
const f = await fixture(app, app.database, origin),
  m = await purchaseMaterial(f, app.database, origin),
  db = app.database;
for (const [table, id, name] of [
  ['orgSubjects', f.a.id, '华东设备公司（隔离验收）'],
  ['orgSubjects', f.b.id, '华南设备公司（隔离验收）'],
  ['personnelEmployees', f.applicant.employee.id, '仓库经办甲'],
  ['personnelEmployees', f.reviewer.employee.id, '独立审核乙'],
  ['materialNames', m.name.id, '检修手套'],
  ['materialSkus', m.sku.id, '耐磨手套 A 型'],
] as const)
  await db.repository(table).updateOne({ filter: { id }, values: { name } });
await db
  .repository('materialSubjectSettings')
  .updateOne({
    filter: { id: String(m.admission.id) },
    values: { canSell: true },
  });
const roles = [
  'procurement-order-operator',
  'sales-order-operator',
  'sales-customer-manager',
  'warehouse-stock-reader',
  'warehouse-stock-operator',
  'warehouse-controlled-operator',
  'warehouse-stock-reverser',
  'warehouse-transfer-operator',
  'warehouse-count-operator',
  'execution-review-configurator',
  'requisitions-requester',
];
for (const permissionSet of roles)
  await f.authz.permissionSets.assign({
    permissionSet,
    subject: { type: 'user', id: f.applicant.user.id },
  });
for (const permissionSet of [
  'procurement-order-reviewer',
  'sales-order-reviewer',
  'warehouse-controlled-reviewer',
  'warehouse-transfer-reviewer',
  'warehouse-count-reviewer',
  'requisitions-request-reviewer',
])
  await f.authz.permissionSets.assign({
    permissionSet,
    subject: { type: 'user', id: f.reviewer.user.id },
  });
const warehouse = await f.create('/materials/warehouses', {
    subjectId: f.a.id,
    name: '东区主仓',
  }),
  destination = await f.create('/materials/warehouses', {
    subjectId: f.a.id,
    name: '东区备仓',
  }),
  supplier = await f.create('/procurement/suppliers', {
    subjectId: f.a.id,
    code: 'PARTNER-EXEC',
    name: '精工设备服务有限公司',
    notes: '采购联系说明',
    requestKey: randomUUID(),
  });
await f.create('/sales/customerRoles', {
  subjectId: f.a.id,
  partnerId: supplier.partnerId,
  notes: '销售联系说明',
  requestKey: randomUUID(),
});
const action = async (
  base: string,
  row: { id: string; revision: number; lifecycleVersion: number },
  transition: string,
  session = f.admin,
) => {
  const response = await send(
      session,
      `${base}/${row.id}/${transition}`,
      mutation(row),
      'POST',
      origin,
    ),
    body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body.error));
  return body.data;
};
for (const kind of [
  'purchaseOrders',
  'salesOrders',
  'stockDocuments',
  'stockTransfers',
  'stockCounts',
]) {
  const response = await send(
    f.admin,
    '/warehouse/settings',
    {
      subjectId: f.a.id,
      kind,
      version: 0,
      requestKey: randomUUID(),
      values: {
        reviewerSelections: [
          { type: 'user', referenceId: f.reviewer.user.id, group: 1 },
        ],
      },
    },
    'PUT',
    origin,
  );
  assert.equal(
    response.status,
    200,
    JSON.stringify((await response.json()).error),
  );
}
await f.saveRules();
let demand = await f.draft(m.content);
demand = await f.fire(demand, 'submit');
demand = await f.fire(demand, 'approve', f.reviewer.session);
const header = {
    subjectId: f.a.id,
    warehouseId: warehouse.id,
    occurredOn: '2026-10-19',
    reason: '设备日常保障',
    notes: '',
  },
  line = (quantity: string) => ({
    id: randomUUID(),
    selection: {
      kind: 'known',
      subjectId: f.a.id,
      skuId: m.sku.id,
      unitId: String(m.each.id),
      quantity,
    },
    notes: '',
  }),
  orderContent = (quantity: string) => ({
    ...header,
    partnerId: supplier.partnerId,
    currency: 'CNY',
    deliveryOn: null,
    deliveryTerms: '分批交付、逐次验收',
    lines: [
      { ...line(quantity), unitPrice: '12.50', allocations: [] as unknown[] },
    ],
  }),
  // A transition answers with the minimal commit result; codes and frozen
  // snapshots only exist on the real detail projection, so read it back.
  detail = async (base: string, id: string) => {
    const response = await send(
        f.admin,
        `${base}/${id}`,
        undefined,
        'GET',
        origin,
      ),
      body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body.error));
    return body.data;
  },
  approve = async (base: string, content: unknown) => {
    let row = await f.create(base, { content, requestKey: randomUUID() });
    row = await action(base, row, 'submit');
    await action(base, row, 'approve', f.reviewer.session);
    return detail(base, row.id);
  };
const poContent = orderContent('10');
poContent.lines[0].allocations = [
  {
    requestId: demand.id,
    requestLineId: demand.lines[0].id,
    requestVersionId: demand.approvedVersionId,
    baseQuantity: '10',
  },
];
const purchase = await approve('/procurement/orders', poContent),
  sales = await approve('/sales/orders', orderContent('8'));
const draftPurchase = await f.create('/procurement/orders', {
  content: orderContent('5'),
  requestKey: randomUUID(),
});
const initial = await f.create('/warehouse/documents', {
  content: {
    ...header,
    kind: 'initial',
    initializationReference: 'OPENING-UI-20261019',
    lines: [{ ...line('60'), quality: 'qualified' }],
  },
  requestKey: randomUUID(),
});
await action('/warehouse/documents', initial, 'post');
const receiptContent = {
  ...header,
  kind: 'purchaseReceipt',
  purchaseOrderId: purchase.id,
  lines: [
    {
      id: randomUUID(),
      purchaseOrderLineId: poContent.lines[0].id,
      quantity: '4',
      quality: 'inspection',
      rejectedQuantity: '1',
      notes: '到货4件，拒收1件，余量继续交付',
    },
  ],
};
const receipt = await f.create('/warehouse/documents', {
  content: receiptContent,
  requestKey: randomUUID(),
});
await action('/warehouse/documents', receipt, 'post');
const draftReceipt = await f.create('/warehouse/documents', {
  content: {
    ...receiptContent,
    lines: [
      {
        ...receiptContent.lines[0],
        id: randomUUID(),
        quantity: '2',
        rejectedQuantity: '0',
        quality: 'qualified',
      },
    ],
  },
  requestKey: randomUUID(),
});
const applicantPosition = await db.repository('orgPositions').findOne({
    filter: {
      id: String(
        (
          await db.repository('personnelAssignments').findOne({
            filter: {
              personId: f.applicant.employee.id,
              status: 'active',
            },
          })
        )?.positionId,
      ),
    },
  }),
  issueUnitId = String(applicantPosition?.unitId);
const issuePurpose = await f.create('/requisitions/purposes', {
  content: {
    subjectId: f.a.id,
    code: 'PURPOSE-EXEC',
    name: '设备检修领用',
    description: '浏览器验收用领用用途',
  },
  requestKey: randomUUID(),
});
const issueSettings = await send(
  f.admin,
  '/requisitions/settings',
  {
    subjectId: f.a.id,
    version: 0,
    requestKey: randomUUID(),
    values: {
      reviewerSelections: [
        { type: 'user', referenceId: f.reviewer.user.id, group: 1 },
      ],
      allowParallelGovernance: false,
      requireProject: false,
    },
  },
  'PUT',
  origin,
);
assert.equal(issueSettings.status, 200);
let issueRequest = await f.create('/requisitions/requests', {
  content: {
    subjectId: f.a.id,
    requesterEmployeeId: f.applicant.employee.id,
    recipientEmployeeId: f.applicant.employee.id,
    requestingUnitId: issueUnitId,
    usage: '设备日常检修',
    neededOn: '2026-10-25',
    purposeId: issuePurpose.id,
    projectId: null,
    notes: '',
    lines: [
      {
        id: randomUUID(),
        selection: {
          kind: 'known',
          subjectId: f.a.id,
          skuId: m.sku.id,
          unitId: String(m.each.id),
          quantity: '40',
        },
        originalName: '',
        originalSpecification: '',
        usage: '',
        notes: '',
      },
    ],
  },
  requestKey: randomUUID(),
});
issueRequest = await action('/requisitions/requests', issueRequest, 'submit');
issueRequest = await action(
  '/requisitions/requests',
  issueRequest,
  'approve',
  f.reviewer.session,
);
const issueDetail = await detail('/requisitions/requests', issueRequest.id);
const transfer = await approve('/warehouse/transfers', {
    ...header,
    destinationWarehouseId: destination.id,
    lines: [line('10')],
  }),
  count = await detail(
    '/warehouse/counts',
    (
      await f.create('/warehouse/counts', {
        content: header,
        requestKey: randomUUID(),
      })
    ).id,
  ),
  postedReceipt = await detail('/warehouse/documents', receipt.id),
  postedDraftReceipt = await detail('/warehouse/documents', draftReceipt.id);
for (const [session, name] of [
  [f.applicant.session, 'operator'],
  [f.reviewer.session, 'reviewer'],
  [f.admin, 'admin'],
  [f.agent.session, 'limited'],
] as const) {
  const cookies = session.cookie.split('; ').map((part) => {
    const i = part.indexOf('=');
    return {
      name: part.slice(0, i),
      value: part.slice(i + 1),
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    };
  });
  await writeFile(
    path.join(dir, `auth-${name}.json`),
    JSON.stringify({ cookies, origins: [] }),
    { mode: 0o600 },
  );
}
const server = await startNodeAppServer(app.server, {
  hostname: '127.0.0.1',
  port: 14036,
  registerProcessSignals: false,
  onListen: () => console.log(`Local: ${origin}${app.publicBasePath}/`),
});
await writeFile(
  path.join(dir, 'fixture.json'),
  JSON.stringify({
    base: `${origin}${app.publicBasePath}/`,
    companyId: f.a.id,
    emptyCompanyId: f.b.id,
    warehouseId: warehouse.id,
    destinationId: destination.id,
    skuId: m.sku.id,
    unitId: m.each.id,
    partnerId: supplier.partnerId,
    purchaseId: purchase.id,
    purchaseCode: purchase.code,
    salesId: sales.id,
    salesCode: sales.code,
    draftPurchaseId: draftPurchase.id,
    draftReceiptId: draftReceipt.id,
    draftReceiptCode: postedDraftReceipt.code,
    receiptId: receipt.id,
    receiptCode: postedReceipt.code,
    transferId: transfer.id,
    transferCode: transfer.code,
    countId: count.id,
    countCode: count.code,
    demandId: demand.id,
    issueRequestId: issueDetail.id,
    issueRequestCode: issueDetail.code,
    issuePurposeId: issuePurpose.id,
  }),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await closeNodeServer(server);
  await app.close();
  for (const file of [
    'auth-operator.json',
    'auth-reviewer.json',
    'auth-admin.json',
    'auth-limited.json',
    'fixture.json',
    'stop-fixture',
  ])
    await unlink(path.join(dir, file)).catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
setInterval(
  () =>
    void access(path.join(dir, 'stop-fixture'))
      .then(close)
      .catch(() => undefined),
  500,
);

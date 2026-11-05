import type { z } from 'zod';
import type { purchaseContent } from '../../../server/providers/purchase-request-model.js';
import path from 'node:path';
import { mkdir, writeFile, unlink, access } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { createTestApp } from '@nocobase/app-testing/server';
import { startNodeAppServer, closeNodeServer } from '@nocobase/app-server/node';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { createStandaloneServer } from '../../../server/standalone.js';
// All accounts, data and cookies belong to this disposable app; no live config is loaded.
const root = path.resolve(import.meta.dirname, '../../..'),
  dir = path.join(root, 'storage/ui-workflow/procurement-requests'),
  origin = 'http://127.0.0.1:14030',
  stopFile = path.join(dir, 'stop-fixture');
await mkdir(dir, { recursive: true });
await unlink(stopFile).catch(() => undefined);
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
const admin = await signIn(app, DEFAULT_ADMIN_CREDENTIALS),
  users = app.application.container.resolve(userAdministrationServiceToken),
  authz = app.application.container.resolve(authorizationToken),
  db = app.database;
const send = async (
  session: typeof admin,
  route: string,
  body: unknown,
  method = 'POST',
) => {
  const r = await session.fetch(route, {
    method,
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
  const v = await r.json();
  if (!r.ok) throw new Error(`${route}: ${r.status} ${JSON.stringify(v)}`);
  return v.data;
};
const create = (route: string, body: unknown) => send(admin, route, body);
const company = await create('/organization/subjects', {
    code: 'UI-PURCHASE',
    name: '采购验收公司甲',
    type: 'group',
  }),
  other = await create('/organization/subjects', {
    code: 'UI-OTHER',
    name: '采购验收公司乙',
    type: 'group',
  }),
  empty = await create('/organization/subjects', {
    code: 'UI-EMPTY',
    name: '采购空白验收公司',
    type: 'group',
  });
const unit = await create('/organization/units', {
    subjectId: company.id,
    type: 'department',
    code: 'UI-UNIT',
    name: '设备保障部',
  }),
  position = await create('/organization/positions', {
    unitId: unit.id,
    code: 'UI-POS',
    name: '设备岗位',
  });
async function person(name: string) {
  const password = randomUUID(),
    user = await users.create({
      name,
      email: `${randomUUID()}@example.test`,
      password,
    }),
    session = await signIn(app, { email: user.email!, password }),
    employee = await create('/people/employees', {
      code: randomUUID(),
      name,
      subjectId: company.id,
      data: { accountId: user.id },
    });
  for (const table of ['personnelEmployments', 'personnelAssignments'])
    await db.repository(table).createOne({
      values: {
        id: randomUUID(),
        code: randomUUID(),
        name,
        subjectId: company.id,
        personId: employee.id,
        positionId: table === 'personnelAssignments' ? position.id : null,
        data: {
          type: table === 'personnelAssignments' ? 'primary' : 'employee',
          startDate: '2020-01-01',
          endDate: null,
        },
        status: 'active',
        revision: 1,
        lifecycleVersion: 0,
        createdBy: 'isolated-fixture',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  return { user, session, employee };
}
const applicant = await person('采购申请人（验收）'),
  reviewer = await person('采购审核人（验收）'),
  configurator = await person('采购配置人（验收）');
for (const [who, role] of [
  [applicant, 'procurement-requester'],
  [reviewer, 'procurement-request-reviewer'],
  [reviewer, 'materials-reviewer'],
  [configurator, 'procurement-review-configurator'],
] as const)
  await authz.permissionSets.assign({
    permissionSet: role,
    subject: { type: 'user', id: who.user.id },
  });
const rule = await send(
  admin,
  '/procurement/settings',
  {
    subjectId: company.id,
    version: 0,
    requestKey: randomUUID(),
    values: {
      reviewerSelections: [
        { group: 1, type: 'user', referenceId: reviewer.user.id },
      ],
      allowParallelGovernance: true,
      requireProject: false,
    },
  },
  'PUT',
);
const template = await create('/materials/templates', {
    name: '采购验收规格',
    fields: [
      {
        key: 'model',
        title: '型号',
        type: 'text',
        identity: true,
        required: true,
      },
    ],
  }),
  name = await create('/materials/names', {
    name: '耐磨手套',
    templateId: template.id,
  });
const each = await db
    .repository('measureUnits')
    .findOne({ filter: { code: 'EA' } }),
  box = await db
    .repository('measureUnits')
    .findOne({ filter: { code: 'BOX' } });
async function activate(
  kind: string,
  row: { id: string; lifecycleVersion: number },
) {
  let result = row;
  for (const transition of ['submit', 'approve'])
    result = await send(
      transition === 'submit' ? admin : reviewer.session,
      `/materials/${kind}/${result.id}/${transition}`,
      {
        version: result.lifecycleVersion,
        requestKey: randomUUID(),
        reason: '临时验收启用',
      },
    );
  return result;
}
const sku = await activate(
  'skus',
  await create('/materials/skus', {
    name: '耐磨手套 · 加厚红色',
    materialNameId: name.id,
    baseUnitId: each!.id,
    managementMode: 'stock',
    attributeValues: { model: '加厚红色' },
  }),
);
await create('/materials/subjectSettings', {
  name: '采购准入',
  subjectId: company.id,
  skuId: sku.id,
  canPurchase: true,
  canSell: false,
});
const pack12 = await activate(
    'unitRules',
    await create('/materials/unitRules', {
      name: '每箱12件',
      skuId: sku.id,
      unitId: box!.id,
      numerator: '12',
      denominator: '1',
    }),
  ),
  pack24 = await activate(
    'unitRules',
    await create('/materials/unitRules', {
      name: '每箱24件',
      skuId: sku.id,
      unitId: box!.id,
      numerator: '24',
      denominator: '1',
    }),
  );
const supplier = await create('/procurement/suppliers', {
  subjectId: company.id,
  code: 'UI-SUP',
  name: '设备采购供应商（临时验收）',
  requestKey: randomUUID(),
});
const unknown = () => ({
  id: randomUUID(),
  selection: {
    kind: 'unknown' as const,
    subjectId: company.id,
    originalName: '现场旧叫法阀门',
    originalSpecification: '耐压、耐高温，需要核对型号',
    requestedUnitText: '套',
    quantity: '3.125',
  },
  originalName: '现场旧叫法阀门',
  originalSpecification: '耐压、耐高温，需要核对型号',
  usage: '设备维护',
  notes: '原始需求说明\n保留换行',
});
const content = (usage = '临时采购需求'): z.input<typeof purchaseContent> => ({
  subjectId: company.id,
  requesterEmployeeId: applicant.employee.id,
  requestingUnitId: unit.id,
  usage,
  neededOn: '2026-11-01',
  suggestedSupplierId: supplier.partnerId,
  projectId: null,
  notes: '临时隔离验收资料',
  lines: [unknown()],
});
const make = (values = content()) =>
  send(applicant.session, '/procurement/requests', {
    content: values,
    requestKey: randomUUID(),
  });
const fire = (
  row: { id: string; revision: number; lifecycleVersion: number },
  transition: string,
  session = applicant.session,
) =>
  send(session, `/procurement/requests/${row.id}/${transition}`, {
    version: row.revision,
    lifecycleVersion: row.lifecycleVersion,
    requestKey: randomUUID(),
    reason: `临时验收 ${transition}`,
  });
const pending = await fire(
    await make(content('待审核的未知物料需求')),
    'submit',
  ),
  approved = await fire(
    await fire(await make(content('已批准但仍有未知物料')), 'submit'),
    'approve',
    reviewer.session,
  ),
  cancelled = await fire(await make(content('已取消待复制申请')), 'cancel');
const mixed = await make({
  ...content('已知与未知混合需求'),
  lines: [
    {
      id: randomUUID(),
      selection: {
        kind: 'known',
        subjectId: company.id,
        skuId: sku.id,
        quantity: '2',
        unitId: String(box!.id),
        unitRuleId: pack12.id,
      },
      originalName: '工地手套',
      originalSpecification: '原叫法规格',
      usage: '劳保使用',
      notes: '',
    },
    unknown(),
  ],
});
for (let i = 0; i < 19; i++)
  await make(content(`分页需求 ${String(i + 1).padStart(2, '0')}`));
const pagePassword = randomUUID(),
  pageUser = await users.create({
    name: '采购仅页面权限',
    email: `${randomUUID()}@example.test`,
    password: pagePassword,
  }),
  pageOnly = await signIn(app, {
    email: pageUser.email!,
    password: pagePassword,
  });
const pageRole = await authz.permissionSets.create({
  key: randomUUID(),
  title: '临时仅页面',
  grants: [
    {
      resource: { type: 'page', id: 'procurement-requests' },
      actions: [{ action: 'access' }],
    },
  ],
});
await authz.permissionSets.assign({
  permissionSet: pageRole.key,
  subject: { type: 'user', id: pageUser.id },
});
for (const [session, file] of [
  [admin, 'auth-admin.json'],
  [applicant.session, 'auth-applicant.json'],
  [reviewer.session, 'auth-reviewer.json'],
  [configurator.session, 'auth-configurator.json'],
  [pageOnly, 'auth-page-only.json'],
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
    path.join(dir, file),
    JSON.stringify({ cookies, origins: [] }),
    { mode: 0o600 },
  );
}
await mkdir(path.join(root, 'storage/verification/purchase-request-ui'), {
  recursive: true,
});
const swagger = await admin.fetch('/swagger');
if (!swagger.ok) throw new Error('Authenticated API document unavailable');
await writeFile(
  path.join(root, 'storage/verification/purchase-request-ui/swagger.json'),
  await swagger.text(),
);
const server = await startNodeAppServer(app.server, {
  hostname: '127.0.0.1',
  port: 14030,
  registerProcessSignals: false,
  onListen: (info) =>
    console.log(`Local: http://127.0.0.1:${info.port}${app.publicBasePath}/`),
});
await writeFile(
  path.join(dir, 'fixture.json'),
  JSON.stringify({
    base: `${origin}${app.publicBasePath}/`,
    companyId: company.id,
    otherCompanyId: other.id,
    emptyCompanyId: empty.id,
    employeeId: applicant.employee.id,
    unitId: unit.id,
    reviewerId: reviewer.user.id,
    pendingId: pending.id,
    approvedId: approved.id,
    cancelledId: cancelled.id,
    mixedId: mixed.id,
    skuId: sku.id,
    boxId: box!.id,
    pack12Id: pack12.id,
    pack24Id: pack24.id,
    ruleRevision: rule.revision,
  }),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await closeNodeServer(server);
  await app.close();
  for (const name of [
    'auth-admin.json',
    'auth-applicant.json',
    'auth-reviewer.json',
    'auth-configurator.json',
    'auth-page-only.json',
    'stop-fixture',
    'fixture.json',
  ])
    await unlink(path.join(dir, name)).catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
setInterval(
  () =>
    void access(stopFile)
      .then(close)
      .catch(() => undefined),
  500,
);

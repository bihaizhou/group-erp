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
// Synthetic, disposable browser fixture. Never loads config.yml or live data.
const root = path.resolve(import.meta.dirname, '../../..'),
  directory = path.join(root, 'storage/ui-workflow/procurement-suppliers'),
  origin = 'http://127.0.0.1:14029',
  stopFile = path.join(directory, 'stop-fixture');
await mkdir(directory, { recursive: true });
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
  authz = app.application.container.resolve(authorizationToken),
  users = app.application.container.resolve(userAdministrationServiceToken);
const send = async (route: string, body: unknown, method = 'POST') => {
  const r = await admin.fetch(route, {
    method,
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`${route}: ${JSON.stringify(json)}`);
  return json.data;
};
// Discover and preserve the authenticated API contract used by the browser.
const swagger = await admin.fetch('/swagger');
if (!swagger.ok) throw new Error('Authenticated swagger unavailable');
await mkdir(path.join(root, 'storage/verification/supplier-ui'), {
  recursive: true,
});
await writeFile(
  path.join(root, 'storage/verification/supplier-ui/swagger.json'),
  await swagger.text(),
);
const sector = await send('/organization/sectors', {
    code: 'UI-SECTOR',
    name: '验收行业',
  }),
  region = await send('/organization/regions', {
    code: 'UI-EAST',
    name: '华东区域',
  }),
  leaf = await send('/organization/regions', {
    code: 'UI-EAST-LEAF',
    name: '华东下级区域',
    parentId: region.id,
  });
const companyA = await send('/organization/subjects', {
    code: 'UI-A',
    name: '项目公司甲（临时验收）',
    type: 'company',
    sectorId: sector.id,
    regionId: leaf.id,
  }),
  companyB = await send('/organization/subjects', {
    code: 'UI-B',
    name: '项目公司乙（临时验收）',
    type: 'company',
    sectorId: sector.id,
    regionId: leaf.id,
  }),
  emptyCompany = await send('/organization/subjects', {
    code: 'UI-EMPTY',
    name: '空白公司（临时验收）',
    type: 'group',
  });
const supplier = await send('/procurement/suppliers', {
  subjectId: companyA.id,
  code: 'UI-SUP-01',
  name: '华东设备供应商（跨区域长期合作伙伴与长名称展示验收）',
  registrationCode: 'UI-REG-01',
  notes: '首个公司设置',
  requestKey: randomUUID(),
});
const policy = (
  await (
    await admin.fetch(
      `/procurement/supplierIdentities/${supplier.partnerId}/applicability`,
    )
  ).json()
).data;
await send(
  `/procurement/supplierIdentities/${supplier.partnerId}/applicability`,
  {
    scopeMode: 'all',
    regionIds: [],
    subjectIds: [],
    version: policy.revision,
    reason: '临时验收：全部公司适用',
    requestKey: randomUUID(),
  },
  'PUT',
);
await send('/procurement/suppliers', {
  subjectId: companyA.id,
  code: 'UI-SUP-02',
  name: '仅甲公司供应商',
  notes: '多行备注\n用于检查显示',
  requestKey: randomUUID(),
});
async function account(key: string, grants: unknown[]) {
  const email = `${key}-${randomUUID()}@example.test`,
    password = randomUUID(),
    user = await users.create({ email, password, name: '供应商隔离验收账号' });
  const role = await authz.permissionSets.create({
    key,
    title: '供应商临时浏览器验收角色',
    grants: grants as Parameters<
      typeof authz.permissionSets.create
    >[0]['grants'],
  });
  await authz.permissionSets.assign({
    permissionSet: role.key,
    subject: { type: 'user', id: user.id },
  });
  return signIn(app, { email, password });
}
const pageGrant = {
  resource: { type: 'page', id: 'procurement-suppliers' },
  actions: [{ action: 'access' }],
};
const tables = [
  'businessPartners',
  'partnerSubjectSettings',
  'supplyChainAudit',
  'orgSubjects',
  'orgRegions',
  'partnerRolePolicies',
  'partnerRegionScopes',
  'partnerCompanyScopes',
];
const reader = await account('supplier-ui-reader', [
  pageGrant,
  {
    resource: { type: 'composite', id: 'procurement.suppliers' },
    actions: [
      {
        action: 'read',
        policy: {
          type: 'composite',
          scopes: {
            ...Object.fromEntries(tables.map((v) => [v, 'allRecords'])),
            orgSubjects: {
              type: 'recordAccess',
              key: 'supplyChain.subjects',
              params: { subjectIds: [companyA.id] },
            },
            partnerSubjectSettings: {
              type: 'recordAccess',
              key: 'procurement.supplierCompanies',
              params: { subjectIds: [companyA.id] },
            },
          },
        },
      },
    ],
  },
]);
const pageCompany = await send('/organization/subjects', {
  code: 'UI-PAGE',
  name: '分页验收公司',
  type: 'group',
});
for (let i = 0; i < 22; i++)
  await send('/procurement/suppliers', {
    subjectId: pageCompany.id,
    code: `UI-PAGE-${String(i).padStart(2, '0')}`,
    name: `分页供应商${i}`,
    notes: '',
    requestKey: randomUUID(),
  });
const pageOnly = await account('supplier-ui-page-only', [pageGrant]);
const scopeOnly = await account('supplier-ui-scope-only', [
  pageGrant,
  {
    resource: { type: 'composite', id: 'procurement.suppliers' },
    actions: [
      {
        action: 'configureApplicability',
        policy: {
          type: 'composite',
          scopes: Object.fromEntries(tables.map((v) => [v, 'allRecords'])),
        },
      },
    ],
  },
]);
async function sessionFile(session: typeof admin, name: string) {
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
    path.join(directory, name),
    JSON.stringify({ cookies, origins: [] }),
    { mode: 0o600 },
  );
}
await sessionFile(admin, 'auth.json');
await sessionFile(reader, 'auth-reader.json');
await sessionFile(pageOnly, 'auth-page-only.json');
await sessionFile(scopeOnly, 'auth-scope-only.json');
const server = await startNodeAppServer(app.server, {
  hostname: '127.0.0.1',
  port: 14029,
  registerProcessSignals: false,
  onListen: (info) =>
    console.log(`Local: http://127.0.0.1:${info.port}${app.publicBasePath}/`),
});
await writeFile(
  path.join(directory, 'fixture.json'),
  JSON.stringify({
    base: `${origin}${app.publicBasePath}/`,
    companyA: companyA.id,
    companyB: companyB.id,
    emptyCompany: emptyCompany.id,
    pageCompany: pageCompany.id,
    regionId: region.id,
    partnerId: supplier.partnerId,
    supplierName: supplier.identity.name,
  }),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await closeNodeServer(server);
  await app.close();
  for (const name of [
    'auth.json',
    'auth-reader.json',
    'auth-page-only.json',
    'auth-scope-only.json',
    'stop-fixture',
  ])
    await unlink(path.join(directory, name)).catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
setInterval(
  () =>
    void access(stopFile)
      .then(close)
      .catch(() => undefined),
  500,
);

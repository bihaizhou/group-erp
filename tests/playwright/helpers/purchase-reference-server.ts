import path from 'node:path';
import { mkdir, writeFile, unlink, access } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { createTestApp } from '@nocobase/app-testing/server';
import { startNodeAppServer, closeNodeServer } from '@nocobase/app-server/node';
import { DEFAULT_ADMIN_CREDENTIALS } from '@nocobase/app-plugin-authentication/testing';
import { createStandaloneServer } from '../../../server/standalone.js';
import { fixture, purchaseMaterial } from '../../helpers/purchase-requests.js';
import { businessDate } from '../../../server/providers/business-date.js';
const root = path.resolve(import.meta.dirname, '../../..'),
  dir = path.join(root, 'storage/ui-workflow/purchase-reference-coordination'),
  origin = 'http://127.0.0.1:14031';
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
  m = await purchaseMaterial(f, app.database, origin);
const supplier = await f.create('/procurement/suppliers', {
  subjectId: f.a.id,
  name: '引用协调供应商',
  code: randomUUID(),
  notes: '',
  requestKey: randomUUID(),
});
await f.saveRules();
const pending = await f.fire(
  await f.draft({ ...m.content, suggestedSupplierId: supplier.partnerId }),
  'submit',
);
const change = await f.create('/people/changes', {
  code: randomUUID(),
  name: '未完审核离职交接',
  personId: f.reviewer.employee.id,
  data: {
    type: 'exit',
    effectiveDate: businessDate(),
    explanation: 'Isolated reference check',
  },
});
for (const permissionSet of [
  'organization-reader',
  'company-personnel-maintainer',
  'materials-maintainer',
])
  await f.authz.permissionSets.assign({
    permissionSet,
    subject: { type: 'user', id: f.agent.user.id },
  });
for (const [session, name] of [
  [f.admin, 'admin'],
  [f.agent.session, 'restricted'],
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
  port: 14031,
  registerProcessSignals: false,
  onListen: () => console.log(`Local: ${origin}${app.publicBasePath}/`),
});
await writeFile(
  path.join(dir, 'fixture.json'),
  JSON.stringify({
    base: `${origin}${app.publicBasePath}/`,
    companyId: f.a.id,
    emptyCompanyId: f.b.id,
    unitId: f.unit.id,
    employeeId: f.reviewer.employee.id,
    changeId: change.id,
    skuId: m.sku.id,
    admissionId: m.admission.id,
    nameId: m.name.id,
    supplierId: supplier.partnerId,
    requestId: pending.id,
    requestCode: pending.code,
  }),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await closeNodeServer(server);
  await app.close();
  for (const file of [
    'auth-admin.json',
    'auth-restricted.json',
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

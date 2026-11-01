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
  dir = path.join(root, 'storage/ui-workflow/requisitions'),
  origin = 'http://127.0.0.1:14032';
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
for (const [table, id, name] of [
  ['orgSubjects', f.a.id, '华东项目公司（验收）'],
  ['orgSubjects', f.b.id, '华南项目公司（验收）'],
  ['orgUnits', f.unit.id, '设备保障部'],
  ['personnelEmployees', f.applicant.employee.id, '申请人甲'],
  ['personnelEmployees', f.reviewer.employee.id, '审核人乙'],
  ['personnelEmployees', f.agent.employee.id, '经办人丙'],
  ['materialNames', m.name.id, '检修手套'],
  ['materialSkus', m.sku.id, '耐磨手套 A 型'],
  ['materialUnitRules', m.pack.id, '每箱12件'],
] as const)
  await app.database
    .repository(table)
    .updateOne({ filter: { id }, values: { name } });
for (const [permissionSet, accountId] of [
  ['requisitions-requester', f.applicant.user.id],
  ['requisitions-source-requester', f.applicant.user.id],
  ['requisitions-request-reviewer', f.reviewer.user.id],
  ['requisitions-request-agent', f.agent.user.id],
  ['requisitions-purpose-maintainer', f.agent.user.id],
  ['requisitions-review-configurator', f.agent.user.id],
] as const)
  await f.authz.permissionSets.assign({
    permissionSet,
    subject: { type: 'user', id: accountId },
  });
const purpose = await f.create('/requisitions/purposes', {
  content: {
    subjectId: f.a.id,
    code: 'REPAIR',
    name: '设备维修',
    description: '用于维修与保养所需的库存物料。',
  },
  requestKey: randomUUID(),
});
const configured = await send(
  f.admin,
  '/requisitions/settings',
  {
    subjectId: f.a.id,
    version: 0,
    requestKey: randomUUID(),
    values: f.rules(),
  },
  'PUT',
  origin,
);
assert.equal(configured.status, 200);
const content = {
  subjectId: f.a.id,
  requesterEmployeeId: f.applicant.employee.id,
  recipientEmployeeId: f.applicant.employee.id,
  requestingUnitId: f.unit.id,
  purposeId: purpose.id,
  usage: '设备检修及日常保养',
  neededOn: f.content().neededOn,
  projectId: null,
  notes: '按实际需求领用，仓库发放在后续凭证中办理。',
  lines: m.content.lines,
};
const create = async (value = content) => {
  const response = await send(
    f.applicant.session,
    '/requisitions/requests',
    {
      content: {
        ...value,
        lines: value.lines.map((line) => ({ ...line, id: randomUUID() })),
      },
      requestKey: randomUUID(),
    },
    'POST',
    origin,
  );
  const body = await response.json();
  assert.equal(response.status, 201, String(body.error?.reason));
  return body.data;
};
const draft = await create(),
  mixed = await create({
    ...content,
    lines: [...content.lines, f.line()],
  } as never);
let pending = await create();
const submitted = await send(
  f.applicant.session,
  `/requisitions/requests/${pending.id}/submit`,
  mutation(pending),
  'POST',
  origin,
);
assert.equal(submitted.status, 200);
pending = (await submitted.json()).data;
const offered: {
  domain: string;
  id: string;
  code: string;
  lineId: string;
  taskId: string;
}[] = [];
await f.saveRules();
for (const domain of ['procurement', 'requisitions']) {
  let row =
    domain === 'procurement'
      ? await f.draft()
      : await create({ ...content, lines: [f.line()] } as never);
  for (const [action, session] of [
    ['submit', f.applicant.session],
    ['approve', f.reviewer.session],
  ] as const) {
    const response = await send(
      session,
      `/${domain}/requests/${row.id}/${action}`,
      mutation(row),
      'POST',
      origin,
    );
    const body = await response.json();
    assert.equal(response.status, 200, String(body.error?.reason));
    row = body.data;
  }
  const sources = await (
    await f.applicant.session.fetch(`/${domain}/requests/${row.id}/sources`)
  ).json();
  const source = sources.data[0];
  assert.ok(source);
  const task = await (
    await f.admin.fetch(`/materials/requests/${source.requestId}`)
  ).json();
  const response = await send(
    f.admin,
    `/materials/requests/${source.requestId}/resolve`,
    {
      version: task.data.lifecycleVersion,
      requestKey: randomUUID(),
      reason: '候选已核对，请申请方确认单位和包装。',
      resolvedSkuId: m.sku.id,
    },
    'POST',
    origin,
  );
  const body = await response.json();
  assert.equal(response.status, 200, String(body.error?.reason));
  offered.push({
    domain,
    id: row.id,
    code: row.code,
    lineId: row.lines[0].id,
    taskId: source.requestId,
  });
}
for (const [session, name] of [
  [f.admin, 'admin'],
  [f.applicant.session, 'applicant'],
  [f.reviewer.session, 'reviewer'],
  [f.agent.session, 'agent'],
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
  port: 14032,
  registerProcessSignals: false,
  onListen: () => console.log(`Local: ${origin}${app.publicBasePath}/`),
});
await writeFile(
  path.join(dir, 'fixture.json'),
  JSON.stringify({
    base: `${origin}${app.publicBasePath}/`,
    companyId: f.a.id,
    emptyCompanyId: f.b.id,
    employeeId: f.applicant.employee.id,
    unitId: f.unit.id,
    purposeId: purpose.id,
    draftId: draft.id,
    draftCode: draft.code,
    mixedId: mixed.id,
    pendingId: pending.id,
    pendingCode: pending.code,
    skuId: m.sku.id,
    packId: m.pack.id,
    offered,
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
    'auth-applicant.json',
    'auth-reviewer.json',
    'auth-agent.json',
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

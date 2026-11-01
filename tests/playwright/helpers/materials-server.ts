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
// Isolated synthetic fixture. It does not load the user's config or business database.
const root = path.resolve(import.meta.dirname, '../../..'),
  directory = path.join(root, 'storage/ui-workflow/warehouse-materials'),
  origin = 'http://127.0.0.1:14027',
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
  users = app.application.container.resolve(userAdministrationServiceToken),
  authz = app.application.container.resolve(authorizationToken);
async function account(role: string, name: string) {
  const email = `${role}-${randomUUID()}@example.test`,
    password = randomUUID(),
    user = await users.create({ email, password, name });
  await authz.permissionSets.assign({
    permissionSet: role,
    subject: { type: 'user', id: user.id },
  });
  return signIn(app, { email, password });
}
const reviewer = await account('materials-reviewer', '验收审核员'),
  reader = await account('materials-reader', '验收目录使用者');
async function send(session: typeof admin, path: string, body: unknown) {
  const response = await session.fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(body),
    }),
    payload = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(payload));
  return payload.data;
}
const create = (kind: string, body: unknown) =>
  send(admin, `/materials/${kind}`, body);
const fire = (
  session: typeof admin,
  kind: string,
  record: { id: string; lifecycleVersion: number },
  transition: string,
  extra = {},
) =>
  send(session, `/materials/${kind}/${record.id}/${transition}`, {
    version: record.lifecycleVersion,
    requestKey: randomUUID(),
    reason: '临时验收数据',
    ...extra,
  });
async function activate(
  kind: string,
  value: { id: string; lifecycleVersion: number },
) {
  return fire(
    reviewer,
    kind,
    await fire(admin, kind, value, 'submit'),
    'approve',
  );
}
const subject = await send(admin, '/organization/subjects', {
  code: 'MAT-UI',
  name: '验收主体（临时）',
  type: 'group',
});
const template = await create('templates', {
  code: 'PEN-SPEC',
  name: '中性笔规格',
  fields: [
    {
      key: 'color',
      title: '颜色',
      type: 'option',
      required: true,
      identity: true,
      options: ['黑色', '红色', '蓝色'],
    },
    {
      key: 'tip',
      title: '笔尖直径',
      type: 'number',
      required: true,
      identity: true,
      unit: 'mm',
    },
  ],
});
const name = await create('names', {
  code: 'GEL-PEN',
  name: '中性笔',
  templateId: template.id,
});
const units = await app.database
    .repository('measureUnits')
    .findMany({ limit: 100 }),
  pen = units.find((v) => v.code === 'PEN')!,
  box = units.find((v) => v.code === 'BOX')!,
  volume = units.find((v) => v.code === 'M3')!;
const black = await activate(
  'skus',
  await create('skus', {
    code: 'PEN-BK-05',
    name: '黑色中性笔 0.5mm',
    materialNameId: name.id,
    baseUnitId: pen.id,
    managementMode: 'stock',
    attributeValues: { color: '黑色', tip: '0.5' },
  }),
);
const red = await activate(
  'skus',
  await create('skus', {
    code: 'PEN-RD-05',
    name: '红色中性笔 0.5mm',
    materialNameId: name.id,
    baseUnitId: pen.id,
    managementMode: 'stock',
    attributeValues: { color: '红色', tip: '0.5' },
  }),
);
const draft = await create('skus', {
  code: 'PEN-BL-05',
  name: '蓝色中性笔 0.5mm',
  materialNameId: name.id,
  baseUnitId: pen.id,
  managementMode: 'stock',
  attributeValues: { color: '蓝色', tip: '0.5' },
});
await activate(
  'unitRules',
  await create('unitRules', {
    name: '每盒 12 支',
    skuId: black.id,
    unitId: box.id,
    numerator: '12',
    denominator: '1',
  }),
);
await activate(
  'references',
  await create('references', {
    name: '签字笔',
    targetKind: 'names',
    targetId: name.id,
    sourceType: 'alias',
  }),
);
const tag = await create('tags', { name: '日常办公', appliesTo: 'both' });
await create('tagLinks', {
  name: '中性笔用途',
  tagId: tag.id,
  targetKind: 'names',
  targetId: name.id,
});
const bulkName = await create('names', {
  name: '中砂',
});
const bulk = await activate(
  'skus',
  await create('skus', {
    code: 'SAND-M',
    name: '中砂（散装）',
    materialNameId: bulkName.id,
    baseUnitId: volume.id,
    managementMode: 'stock',
    attributeValues: {},
  }),
);
const request = await fire(
  admin,
  'requests',
  await create('requests', {
    name: '会议室需要签字笔',
    subjectId: subject.id,
    specification: '黑色 0.5mm，整盒采购',
    usage: '会议室办公',
  }),
  'submit',
);
const warehouse = await create('warehouses', {
  code: 'MAIN',
  name: '综合仓',
  subjectId: subject.id,
});
async function saveSession(session: typeof admin, name: string) {
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
await saveSession(admin, 'auth.json');
await saveSession(reader, 'auth-reader.json');
await saveSession(reviewer, 'auth-reviewer.json');
const server = await startNodeAppServer(app.server, {
  hostname: '127.0.0.1',
  port: 14027,
  registerProcessSignals: false,
  onListen: (info) =>
    console.log(`Local: http://127.0.0.1:${info.port}${app.publicBasePath}/`),
});
await writeFile(
  path.join(directory, 'fixture.json'),
  JSON.stringify({
    base: `${origin}${app.publicBasePath}/`,
    subjectId: subject.id,
    skuId: black.id,
    redSkuId: red.id,
    draftId: draft.id,
    bulkId: bulk.id,
    requestId: request.id,
    warehouseId: warehouse.id,
    templateId: template.id,
    nameId: name.id,
    tagId: tag.id,
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
    'auth-reviewer.json',
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

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
import { businessDate } from '../../../server/providers/business-date.js';
import { createStandaloneServer } from '../../../server/standalone.js';

// This fixture owns a disposable database and storage. It never opens config.yml,
// production credentials or the business database used by the deployed ERP.
const root = path.resolve(import.meta.dirname, '../../..');
const directory = path.join(root, 'storage/ui-workflow/human-resources');
const port = Number(process.env.PEOPLE_PREVIEW_PORT ?? 14023);
const origin = `http://127.0.0.1:${port}`;
const stopFile = path.join(directory, 'stop-fixture');
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
    users: { initialAdmin: DEFAULT_ADMIN_CREDENTIALS },
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    jobs: { default: 'memory' },
    queue: { default: 'memory' },
    logging: { console: { enabled: false }, file: { enabled: false } },
  },
});
const session = await signIn(app, DEFAULT_ADMIN_CREDENTIALS);
async function send(path: string, body: unknown, method = 'POST') {
  const response = await session.fetch(path, {
    method,
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result.data;
}
const date = businessDate();
const group = await send('/organization/subjects', {
  code: 'UI-GROUP',
  name: '验收集团（临时数据）',
  type: 'group',
});
const unit = await send('/organization/units', {
  code: 'UI-UNIT',
  name: '设备技术部',
  type: 'department',
  subjectId: group.id,
});
const position = await send('/organization/positions', {
  code: 'UI-POSITION',
  name: '设备工程师',
  unitId: unit.id,
});
const employee = await send('/people/employees', {
  code: 'UI-E001',
  name: '验收员工',
  subjectId: group.id,
  data: {
    location: '上海',
    education: '机械工程专业（验收示例）',
    experience: '设备维护与技术改进（验收示例）',
  },
});
let entry = await send('/people/changes', {
  code: 'UI-ENTRY',
  name: '验收入职',
  personId: employee.id,
  data: {
    type: 'entry',
    effectiveDate: date,
    targetSubjectId: group.id,
    targetPositionId: position.id,
    explanation: '仅用于本地验收',
  },
});
for (const transition of ['submit', 'approve'])
  entry = await send(`/people/changes/${entry.id}/fire`, {
    transition,
    version: entry.lifecycleVersion,
    requestId: randomUUID(),
    reason: '本地验收',
  });
const dimensions = [];
for (const [index, name] of [
  '沟通协作',
  '再学习能力',
  '设备专业能力',
  '责任担当',
  '项目协调',
].entries())
  dimensions.push(
    await send('/people/dimensions', {
      code: `UI-D${index}`,
      name,
      data: {
        category: index === 2 ? 'professional' : 'common',
        definition: `${name}的可观察工作表现`,
        standards: [
          '需要指导完成基本任务',
          '能在支持下完成常规任务',
          '能独立完成并解释工作方法',
          '能解决复杂问题并指导他人',
          '能形成方法并推动组织改进',
        ],
        evidence: '项目成果、工作案例与协作反馈',
        applicability: '仅用于验收，非正式集团标准',
      },
    }),
  );
const model = await send('/people/models', {
  code: 'UI-MODEL',
  name: '设备工程师能力模型',
  positionId: position.id,
  data: {
    items: dimensions.map((d) => ({
      dimensionId: d.id,
      target: 4,
      source: d.data.category === 'common' ? 'common' : 'position',
    })),
  },
});
const profiles = await (
  await session.fetch(`/people/profiles?personId=${employee.id}`)
).json();
const profile = await send(
  `/people/profiles/${profiles.data[0].id}`,
  {
    version: profiles.data[0].version,
    reason: '设置验收画像',
    data: {
      ...profiles.data[0].data,
      grade: 3,
      modelId: model.id,
      targetModelId: model.id,
      strengths: '结构化分析、学习速度、跨团队协作',
      improvements: '经营判断、团队培养',
      careerDirection: '向设备专业负责人方向发展',
      potential: '具备承担更复杂技术项目的潜力',
      potentialEvidence: '能快速掌握新设备，并将经验整理为操作规范。',
      toValidate: '通过跨部门项目验证协调与带队能力。',
      performance: [
        { period: '2026年度（验收）', result: 'A', evidence: '验收示例' },
        { period: '2026上半年（验收）', result: 'B+', evidence: '验收示例' },
      ],
      achievements: [
        {
          date,
          title: '设备改进项目（验收示例）',
          contribution: '组织故障分析与技术方案验证',
          result: '形成标准化维护方案',
          evidence: '仅用于界面验收',
        },
      ],
    },
  },
  'PATCH',
);
let evaluation = await send('/people/evaluations', {
  code: 'UI-EVAL',
  name: '年度人才评价（验收）',
  personId: employee.id,
  data: {
    period: '2026年度',
    evaluationDate: date,
    modelId: model.id,
    ratings: dimensions.map((d) => ({ dimensionId: d.id })),
  },
});
for (const [stage, transition] of [
  'selfAssess',
  'managerAssess',
  'confirm',
].entries())
  evaluation = await send(`/people/evaluations/${evaluation.id}/fire`, {
    transition,
    version: evaluation.lifecycleVersion,
    requestId: randomUUID(),
    reason: '验收账号代录并保留来源',
    input: {
      ratings: dimensions.map((d, i) => ({
        dimensionId: d.id,
        score: [4.2, 4.7, 4.3, 4.5, 3.9][i] - (stage === 0 ? 0.1 : 0),
        evidence: `${d.name}的工作案例（验收示例）`,
      })),
    },
  });
let development = await send('/people/developmentPlans', {
  code: 'UI-DEVELOP',
  name: '设备专业负责人培养计划（验收）',
  personId: employee.id,
  data: {
    goal: '提升项目协调和人才培养能力',
    measures: '承担跨部门改进项目，安排导师辅导和阶段复盘',
    owner: '验收负责人',
    dueDate: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
  },
});
development = await send(`/people/developmentPlans/${development.id}/fire`, {
  transition: 'activate',
  version: development.lifecycleVersion,
  requestId: randomUUID(),
  reason: '开始验收培养计划',
});
await mkdir(directory, { recursive: true });
async function saveSession(cookie: string, name: string) {
  const cookies = cookie.split('; ').map((part) => {
    const index = part.indexOf('=');
    return {
      name: part.slice(0, index),
      value: part.slice(index + 1),
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax' as const,
    };
  });
  await writeFile(
    path.join(directory, name),
    JSON.stringify({ cookies, origins: [] }),
    { mode: 0o600 },
  );
}
await saveSession(session.cookie, 'auth.json');
const users = app.application.container.resolve(userAdministrationServiceToken);
const readerEmail = `reader-${randomUUID()}@example.test`,
  readerPassword = randomUUID();
const reader = await users.create({
  name: '验收只读用户',
  email: readerEmail,
  password: readerPassword,
});
const authz = app.application.container.resolve(authorizationToken);
await authz.permissionSets.assign({
  permissionSet: 'human-resources-reader',
  subject: { type: 'user', id: reader.id },
});
const readerSession = await signIn(app, {
  email: readerEmail,
  password: readerPassword,
});
await saveSession(readerSession.cookie, 'auth-limited.json');
const server = await startNodeAppServer(app.server, {
  hostname: '127.0.0.1',
  port,
  registerProcessSignals: false,
  onListen: (info) =>
    console.log(`Local: http://127.0.0.1:${info.port}${app.publicBasePath}/`),
});
await writeFile(
  path.join(directory, 'fixture.json'),
  JSON.stringify({
    base: `${origin}${app.publicBasePath}/`,
    profileId: profile.id,
    personId: employee.id,
    evaluationId: evaluation.id,
    developmentId: development.id,
    subjectId: group.id,
    positionId: position.id,
    modelId: model.id,
    dimensionIds: dimensions.map((d) => d.id),
  }),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await closeNodeServer(server);
  await app.close();
  for (const file of ['auth.json', 'auth-limited.json', 'stop-fixture'])
    await unlink(path.join(directory, file)).catch(() => undefined);
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

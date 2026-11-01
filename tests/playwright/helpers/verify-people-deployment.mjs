import process from 'node:process';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { log } from 'node:console';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

// Production is read-only. Business probes are allowed only through the isolated
// database's loopback port, after the deployment driver verifies DB_DATABASE.
const mode = process.env.ERP_DEPLOYMENT_MODE ?? 'production';
const isolated = mode === 'staging' || mode === 'staging-check';
const base = isolated
  ? 'http://127.0.0.1:14026/main/'
  : 'http://192.168.5.189:13010/main/';
if (isolated)
  assert.equal(
    process.env.ERP_VERIFY_DATABASE,
    'group_erp_people_verify_20261017',
  );
const directory = 'storage/deployments/people-v1-20261017-052526';
await mkdir(`${directory}/screenshots`, { recursive: true });
const secret = JSON.parse(
  await readFile('deploy/initial-admin.secret.json', 'utf8'),
);
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const anon = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const api = (path) => new URL(`api/${path}`, base).href;
  const health = await anon.request.get(api('healthz'));
  assert.equal(health.status(), 200);
  assert.equal((await health.json()).ok, true);
  assert.equal((await anon.request.get(api('people/employees'))).status(), 401);
  assert.equal((await anon.request.get(api('swagger'))).status(), 401);
  const login = await context.request.post(api('auth/sign-in/username'), {
    headers: { Origin: new URL(base).origin },
    data: { username: secret.username, password: secret.password },
  });
  assert.equal(
    login.status(),
    200,
    'Existing administrator sign-in must work; never reset it during deployment',
  );
  const swagger = await context.request.get(api('swagger'));
  assert.equal(swagger.status(), 200);
  const document = await swagger.json();
  const paths = Object.keys(document.paths ?? {});
  assert(paths.some((path) => path.endsWith('/people/employees')));
  assert(paths.some((path) => path.endsWith('/peoplePhotos/uploadOne')));
  async function get(path) {
    const response = await context.request.get(api(path));
    assert.equal(response.status(), 200, `GET ${path}`);
    return response.json();
  }
  async function send(path, data, method = 'POST') {
    assert.equal(
      mode,
      'staging',
      'Business writes are forbidden in production verification',
    );
    const response = await context.request.fetch(api(path), {
      method,
      headers: { Origin: new URL(base).origin },
      data,
    });
    if (!response.ok()) {
      const failure = await response.json();
      const error = failure.error ?? {};
      const fields =
        error.fieldViolations ??
        error.details?.flatMap((detail) => detail.fieldViolations ?? []) ??
        [];
      assert.fail(
        `${method} ${path}: ${response.status()}, ${error.reason ?? 'unknown'}, fields=${fields.map((item) => item.field).join(',')}`,
      );
    }
    return (await response.json()).data;
  }
  const fire = (kind, row, transition, input = {}) =>
    send(`people/${kind}/${row.id}/fire`, {
      transition,
      version: row.lifecycleVersion,
      requestId: randomUUID(),
      reason: 'Isolated PostgreSQL release verification',
      input,
    });
  let fixture;
  if (mode === 'staging') {
    const tag = randomUUID().slice(0, 8).toUpperCase();
    const group = await send('organization/subjects', {
      code: `VERIFY-G-${tag}`,
      name: '发布验证集团（仅隔离库）',
      type: 'group',
    });
    const unit = await send('organization/units', {
      code: `VERIFY-U-${tag}`,
      name: '发布验证部门',
      type: 'department',
      subjectId: group.id,
    });
    const position = await send('organization/positions', {
      code: `VERIFY-P-${tag}`,
      name: '发布验证岗位',
      unitId: unit.id,
    });
    let employee = await send('people/employees', {
      code: `VERIFY-E-${tag}`,
      name: '发布验证员工（仅隔离库）',
      subjectId: group.id,
      data: { location: '隔离验证' },
    });
    const date = (await get('people/options?kind=changes')).meta.businessDate;
    let entry = await send('people/changes', {
      code: `VERIFY-C-${tag}`,
      name: '发布验证入职',
      personId: employee.id,
      data: {
        type: 'entry',
        effectiveDate: date,
        targetSubjectId: group.id,
        targetPositionId: position.id,
        explanation: 'Isolated PostgreSQL release verification',
      },
    });
    entry = await fire('changes', entry, 'submit');
    entry = await fire('changes', entry, 'approve');
    assert.equal(entry.status, 'effective');
    const dimensions = [];
    for (const [i, name] of [
      '沟通协作',
      '再学习能力',
      '岗位专业能力',
    ].entries())
      dimensions.push(
        await send('people/dimensions', {
          code: `VERIFY-D${i}-${tag}`,
          name,
          data: {
            category: i === 0 ? 'common' : 'professional',
            definition: '仅用于隔离副本发布验收',
            standards: [
              '需指导',
              '有支持完成',
              '独立完成',
              '解决复杂问题',
              '形成方法',
            ],
            evidence: '隔离验收案例',
          },
        }),
      );
    const model = await send('people/models', {
      code: `VERIFY-M-${tag}`,
      name: '发布验证模型',
      positionId: position.id,
      data: {
        items: dimensions.map((d) => ({
          dimensionId: d.id,
          target: 4,
          source: d.data.category === 'common' ? 'common' : 'position',
        })),
      },
    });
    let profile = (await get(`people/profiles?personId=${employee.id}`))
      .data[0];
    profile = await send(
      `people/profiles/${profile.id}`,
      {
        version: profile.version,
        reason: 'Verify manual grade and model',
        data: { ...profile.data, grade: 3, modelId: model.id },
      },
      'PATCH',
    );
    let evaluation = await send('people/evaluations', {
      code: `VERIFY-V-${tag}`,
      name: '发布验证评价',
      personId: employee.id,
      data: {
        period: '发布验收',
        evaluationDate: date,
        modelId: model.id,
        ratings: dimensions.map((d) => ({ dimensionId: d.id })),
      },
    });
    for (const transition of ['selfAssess', 'managerAssess', 'confirm'])
      evaluation = await fire('evaluations', evaluation, transition, {
        ratings: dimensions.map((d, i) => ({
          dimensionId: d.id,
          score: [4.2, 4.4, 4.1][i],
          evidence: '隔离副本中的验证案例',
        })),
      });
    assert.equal(evaluation.status, 'confirmed');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR6kAAAAASUVORK5CYII=',
      'base64',
    );
    const upload = await context.request.post(api('peoplePhotos/uploadOne'), {
      headers: { Origin: new URL(base).origin },
      multipart: {
        file: { name: 'verify.png', mimeType: 'image/png', buffer: png },
      },
    });
    assert.equal(upload.status(), 201);
    const photo = (await upload.json()).data.record;
    employee = (await get(`people/employees/${employee.id}`)).data;
    await send(
      `people/employees/${employee.id}`,
      {
        version: employee.version,
        reason: 'Verify private photo binding',
        data: { ...employee.data, photoId: photo.id },
      },
      'PATCH',
    );
    fixture = {
      personId: employee.id,
      profileId: profile.id,
      evaluationId: evaluation.id,
      entryId: entry.id,
      photoId: photo.id,
      photoSha256: createHash('sha256').update(png).digest('hex'),
    };
    await writeFile(
      `${directory}/stage-fixture.json`,
      JSON.stringify(fixture, null, 2),
    );
  }
  if (isolated) {
    fixture ??= JSON.parse(
      await readFile(`${directory}/stage-fixture.json`, 'utf8'),
    );
    assert.equal(
      (await get(`people/profiles/${fixture.profileId}`)).data.grade,
      3,
    );
    assert.equal(
      (await get(`people/changes/${fixture.entryId}`)).data.status,
      'effective',
    );
    assert.equal(
      (await get(`people/evaluations/${fixture.evaluationId}`)).data.status,
      'confirmed',
    );
    const photoUrl = new URL(
      `uploads/peoplePhotos/${fixture.photoId}.png`,
      base,
    ).href;
    const photo = await context.request.get(photoUrl);
    assert.equal(photo.status(), 200);
    assert.equal(
      createHash('sha256')
        .update(await photo.body())
        .digest('hex'),
      fixture.photoSha256,
    );
    assert.equal((await anon.request.get(photoUrl)).status(), 401);
  }
  const counts = {};
  for (const kind of [
    'employees',
    'employments',
    'assignments',
    'changes',
    'dimensions',
    'models',
    'profiles',
    'evaluations',
    'developmentPlans',
    'workforcePlans',
  ])
    counts[kind] = (await get(`people/${kind}`)).meta.total;
  const overview = (await get('people/overview')).data;
  const page = await context.newPage();
  const errors = [],
    failed = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400)
      failed.push({ path: new URL(r.url()).pathname, status: r.status() });
  });
  for (const path of [
    'human-resources',
    'human-resources/profiles',
    'functions/personnel/employees',
    'human-resources/dimensions',
    'organization',
  ]) {
    await page.goto(new URL(path, base).href);
    await page.locator('h1').waitFor();
    assert(!page.url().includes('/login'));
  }
  if (isolated) {
    await page.goto(
      new URL(`human-resources/profiles/${fixture.profileId}`, base).href,
    );
    await page
      .getByRole('heading', {
        level: 1,
        name: '发布验证员工（仅隔离库）',
        exact: true,
      })
      .waitFor();
    await page
      .getByRole('img', { name: /雷达图|radar chart/i })
      .locator('svg')
      .waitFor();
  } else {
    await page.goto(new URL('human-resources', base).href);
    await page.locator('h1').waitFor();
  }
  await page.screenshot({
    path: `${directory}/screenshots/${mode}.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  const report = {
    mode,
    base,
    checkedAt: new Date().toISOString(),
    health: true,
    existingAdminLogin: true,
    anonymousDenied: true,
    swagger: true,
    counts,
    overviewCounts: overview.counts,
    errors,
    failed,
    businessWrites: mode === 'staging' ? 'isolated clone only' : 'none',
    filePersistence: isolated
      ? 'linked file hash verified; anonymous blocked'
      : 'not written in production',
  };
  await writeFile(
    `${directory}/${mode}-verification.json`,
    JSON.stringify(report, null, 2),
  );
  log(JSON.stringify(report));
  await context.close();
  await anon.close();
} finally {
  await browser.close();
}

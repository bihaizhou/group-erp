import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';
import { log } from 'node:console';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { request, chromium } from '@playwright/test';

// Production probes only read business data. Writes require the explicitly
// verified clone, accessed through the SSH tunnel to the internal Docker network.
const mode = process.env.ERP_DEPLOYMENT_MODE ?? 'production';
assert(['staging', 'staging-check', 'production'].includes(mode));
const isolated = mode !== 'production';
if (isolated)
  assert.equal(
    process.env.ERP_VERIFY_DATABASE,
    'group_erp_materials_verify_20261017',
  );
const base = isolated
  ? 'http://127.0.0.1:14028/main/'
  : 'http://192.168.5.189:13010/main/';
const directory = 'storage/deployments/materials-a1-20261017-103315';
await mkdir(`${directory}/screenshots`, { recursive: true });
const admin = JSON.parse(
  await readFile('deploy/initial-admin.secret.json', 'utf8'),
);
const contexts = [];
async function signIn(data, username = false) {
  const context = await request.newContext({
    extraHTTPHeaders: { Origin: new URL(base).origin },
  });
  contexts.push(context);
  const r = await context.post(
    `${base}api/auth/sign-in/${username ? 'username' : 'email'}`,
    { data },
  );
  assert.equal(
    r.status(),
    200,
    'Sign-in must work without resetting an account',
  );
  return context;
}
async function get(context, path) {
  const response = await context.get(`${base}api/${path}`);
  assert.equal(response.status(), 200, `GET ${path}`);
  return response.json();
}
async function send(context, path, data, method = 'POST', status) {
  assert.equal(
    mode,
    'staging',
    'Business writes are forbidden outside the clone',
  );
  const r = await context.fetch(`${base}api/${path}`, { method, data });
  if (status) {
    assert.equal(r.status(), status, `${method} ${path}`);
    return r;
  }
  const body = await r.json();
  assert(
    r.ok(),
    `${method} ${path}: ${r.status()} ${body.error?.reason ?? 'unknown'}`,
  );
  return body.data;
}
const anon = await request.newContext();
contexts.push(anon);
let browser;
try {
  assert.equal((await get(anon, 'healthz')).ok, true);
  for (const path of [
    'materials/skus',
    'materials/catalog',
    'materials/history',
    'people/employees',
    'swagger',
  ])
    assert.equal((await anon.get(`${base}api/${path}`)).status(), 401, path);
  const root = await signIn(
    { username: admin.username, password: admin.password },
    true,
  );
  const document = await get(root, 'swagger');
  assert(document.paths['/api/materials/skus']);
  assert(document.paths['/api/materials/catalog']);
  let fixture;
  const checks = [
    'health',
    'anonymous authentication',
    'original administrator login',
    'API documentation',
  ];
  if (mode === 'staging') {
    const tag = randomUUID().slice(0, 8).toUpperCase();
    async function member(name, role) {
      const password = randomUUID(),
        email = `${name}-${tag}@example.test`;
      const user = await send(root, 'users', {
        name: `Isolated ${name}`,
        email,
        password,
        roleScopes: { app: [role] },
      });
      return { user, session: await signIn({ email, password }) };
    }
    const reviewer = await member('reviewer', 'materials-reviewer');
    const reader = await member('reader', 'materials-reader');
    assert.equal(
      (await reader.session.get(`${base}api/materials/skus`)).status(),
      403,
    );
    await send(
      reader.session,
      'materials/names',
      { arbitrary: true },
      'POST',
      403,
    );
    const group = await send(root, 'organization/subjects', {
      code: `VERIFY-A-${tag}`,
      name: '物料发布验证主体 A（仅隔离库）',
      type: 'group',
    });
    const otherGroup = await send(root, 'organization/subjects', {
      code: `VERIFY-B-${tag}`,
      name: '物料发布验证主体 B（仅隔离库）',
      type: 'group',
    });
    const create = (kind, value) => send(root, `materials/${kind}`, value);
    const fire = (actor, kind, row, transition, extra = {}) =>
      send(actor, `materials/${kind}/${row.id}/${transition}`, {
        version: row.lifecycleVersion,
        requestKey: randomUUID(),
        reason: 'Isolated PostgreSQL release verification',
        ...extra,
      });
    const template = await create('templates', {
      name: `发布验收模板-${tag}`,
      fields: [
        {
          key: 'color',
          title: '颜色',
          type: 'option',
          required: true,
          identity: true,
          options: ['黑色', '红色'],
        },
        {
          key: 'size',
          title: '直径',
          type: 'number',
          required: true,
          identity: true,
          unit: 'mm',
        },
      ],
    });
    const standard = await create('names', {
      name: `发布验收中性笔-${tag}`,
      templateId: template.id,
    });
    const units = (await get(root, 'materials/units?pageSize=100')).data;
    const ea = units.find((v) => v.code === 'EA'),
      box = units.find((v) => v.code === 'BOX'),
      kg = units.find((v) => v.code === 'KG');
    assert(ea && box && kg);
    let task = await create('requests', {
      name: `发布验收需求-${tag}`,
      subjectId: group.id,
      specification: '黑色 0.5mm',
      usage: '仅隔离库发布验收',
    });
    task = await fire(root, 'requests', task, 'submit');
    const identity = {
      name: `发布验收SKU-${tag}`,
      materialNameId: standard.id,
      baseUnitId: ea.id,
      managementMode: 'stock',
      requestId: task.id,
    };
    const duplicates = await Promise.all(
      ['0.5', '0.500000'].map((size) =>
        root.post(`${base}api/materials/skus`, {
          data: { ...identity, attributeValues: { color: '黑色', size } },
        }),
      ),
    );
    assert.deepEqual(duplicates.map((r) => r.status()).sort(), [201, 409]);
    let sku = (await duplicates.find((r) => r.status() === 201).json()).data;
    const creates = (
      await get(root, `materials/history?kind=skus&recordId=${sku.id}`)
    ).data;
    assert.equal(creates.filter((r) => r.operation === 'create').length, 1);
    sku = await fire(root, 'skus', sku, 'submit');
    await send(
      root,
      `materials/skus/${sku.id}/approve`,
      {
        version: sku.lifecycleVersion,
        requestKey: randomUUID(),
        reason: 'Self-review must fail',
      },
      'POST',
      403,
    );
    sku = await fire(reviewer.session, 'skus', sku, 'approve');
    const edits = await Promise.all(
      ['first', 'second'].map((notes) =>
        root.patch(`${base}api/materials/skus/${sku.id}`, {
          data: {
            version: sku.version,
            reason: 'Concurrent version check',
            notes,
          },
        }),
      ),
    );
    assert.deepEqual(edits.map((r) => r.status()).sort(), [200, 409]);
    sku = (await get(root, `materials/skus/${sku.id}`)).data;
    const auditBeforeBad = (await get(root, 'materials/history')).meta.total;
    await send(
      root,
      'materials/unitRules',
      {
        name: 'Invalid variable conversion',
        skuId: sku.id,
        unitId: kg.id,
        numerator: '1',
        denominator: '1',
      },
      'POST',
      400,
    );
    assert.equal(
      (await get(root, 'materials/history')).meta.total,
      auditBeforeBad,
    );
    let packaging = await create('unitRules', {
      name: '12支一盒',
      skuId: sku.id,
      unitId: box.id,
      numerator: '12.000000',
      denominator: '1',
    });
    packaging = await fire(root, 'unitRules', packaging, 'submit');
    await fire(reviewer.session, 'unitRules', packaging, 'approve');
    let alias = await create('references', {
      name: `发布验收签字笔-${tag}`,
      targetKind: 'skus',
      targetId: sku.id,
      sourceType: 'alias',
    });
    alias = await fire(root, 'references', alias, 'submit');
    alias = await fire(reviewer.session, 'references', alias, 'approve');
    const confirmedIdentity = await root.patch(
      `${base}api/materials/references/${alias.id}`,
      {
        data: {
          version: alias.version,
          reason: 'Identity must remain fixed',
          name: 'Changed source alias',
        },
      },
    );
    assert(!confirmedIdentity.ok());
    const query = await get(
      reader.session,
      `materials/catalog?q=${encodeURIComponent(alias.name)}`,
    );
    assert.deepEqual(
      query.data.map((v) => v.id),
      [sku.id],
    );
    const detail = (await get(reader.session, `materials/catalog/${sku.id}`))
      .data;
    assert.equal(detail.packages[0].numerator, '12');
    for (const key of ['createdBy', 'workflow', 'identityKey'])
      assert.equal(detail[key], undefined);
    const resolve = {
      version: task.lifecycleVersion,
      requestKey: randomUUID(),
      reason: 'Isolated request resolved',
      resolvedSkuId: sku.id,
    };
    const results = await Promise.all([
      root.post(`${base}api/materials/requests/${task.id}/resolve`, {
        data: resolve,
      }),
      root.post(`${base}api/materials/requests/${task.id}/resolve`, {
        data: resolve,
      }),
    ]);
    assert.deepEqual(
      results.map((r) => r.status()),
      [200, 200],
    );
    task = (await get(root, `materials/requests/${task.id}`)).data;
    assert.equal(task.status, 'resolved');
    assert.equal(
      (
        await get(root, `materials/history?kind=requests&recordId=${task.id}`)
      ).data.filter((v) => v.operation === 'resolve').length,
      1,
    );
    const warehouse = await create('warehouses', {
      name: '发布验收仓库 A',
      subjectId: group.id,
    });
    const otherWarehouse = await create('warehouses', {
      name: '发布验收仓库 B',
      subjectId: otherGroup.id,
    });
    const roleKey = `verify-material-scope-${tag}`;
    await send(root, 'authorization/permissionSets', {
      key: roleKey,
      title: 'Isolated company scope verification',
      grants: [
        {
          resource: { type: 'composite', id: 'materials.warehouses' },
          actions: ['read', 'update'].map((action) => ({
            action,
            policy: {
              type: 'composite',
              scopes: {
                warehouses: {
                  type: 'recordAccess',
                  key: 'materials.companies',
                  params: { subjectIds: [group.id] },
                },
                orgSubjects: 'allRecords',
                orgUnits: 'allRecords',
                orgPositions: 'allRecords',
              },
            },
          })),
        },
      ],
    });
    const scoped = await member('scoped', roleKey);
    assert.deepEqual(
      (await get(scoped.session, 'materials/warehouses')).data.map((v) => v.id),
      [warehouse.id],
    );
    assert.equal(
      (
        await scoped.session.get(
          `${base}api/materials/warehouses/${otherWarehouse.id}`,
        )
      ).status(),
      404,
    );
    const countBefore = (await get(root, 'materials/warehouses')).meta.total;
    const historyBefore = (await get(root, 'materials/history')).meta.total;
    await send(
      scoped.session,
      'materials/warehouses',
      { name: 'Outside authorized company', subjectId: otherGroup.id },
      'POST',
      403,
    );
    assert.equal(
      (await get(root, 'materials/warehouses')).meta.total,
      countBefore,
    );
    assert.equal(
      (await get(root, 'materials/history')).meta.total,
      historyBefore,
    );
    fixture = {
      skuId: sku.id,
      requestId: task.id,
      warehouseId: warehouse.id,
      skuName: sku.name,
      alias: alias.name,
      notes: sku.notes,
    };
    await writeFile(
      `${directory}/staging-fixture.json`,
      JSON.stringify(fixture, null, 2),
    );
    checks.push(
      'concurrent canonical identity: one create and one conflict',
      'independent review and self-review rejection',
      'concurrent optimistic version: one update and one conflict',
      'failed conversion rolls back without audit',
      'exact packaging and immutable alias',
      'restricted public catalog',
      'concurrent idempotent request resolution',
      'company scopes and rollback of forbidden create',
    );
  } else if (mode === 'staging-check') {
    fixture = JSON.parse(
      await readFile(`${directory}/staging-fixture.json`, 'utf8'),
    );
    assert.equal(
      (await get(root, `materials/skus/${fixture.skuId}`)).data.notes,
      fixture.notes,
    );
    assert.equal(
      (await get(root, `materials/requests/${fixture.requestId}`)).data.status,
      'resolved',
    );
    assert.equal(
      (await get(root, `materials/warehouses/${fixture.warehouseId}`)).data
        .status,
      'active',
    );
    checks.push(
      'PostgreSQL records persist after application and database restart',
    );
  }
  for (const kind of [
    'names',
    'templates',
    'skus',
    'units',
    'unitRules',
    'references',
    'tags',
    'tagLinks',
    'requests',
    'subjectSettings',
    'warehouses',
  ])
    await get(root, `materials/${kind}`);
  await get(root, 'materials/history');
  await get(root, 'people/employees');
  await get(root, 'people/profiles');
  await get(root, 'organization/subjects');
  checks.push('all material endpoints and existing organization/people reads');
  browser = await chromium.launch();
  const view = await browser.newContext({
    storageState: await root.storageState(),
    viewport: { width: 1440, height: 1000 },
  });
  // Block business writes. The shell persists its current language on every
  // load; allowing that preference avoids manufacturing network console errors.
  await view.route('**/api/**', (route) => {
    const current = route.request();
    const preference =
      current.method() === 'PUT' &&
      new URL(current.url()).pathname.endsWith('/api/i18n/locale');
    return ['GET', 'HEAD', 'OPTIONS'].includes(current.method()) || preference
      ? route.continue()
      : route.abort();
  });
  const page = await view.newPage(),
    errors = [],
    failures = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400)
      failures.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  await page.goto(`${base}functions/warehouse/materials`);
  await page.getByRole('heading', { name: '物料中心', exact: true }).waitFor();
  if (isolated)
    await page
      .getByRole('link', { name: fixture.skuName, exact: true })
      .waitFor();
  else
    await page
      .getByRole('button', { name: '新建物料 SKU', exact: true })
      .waitFor();
  await page.screenshot({
    path: `${directory}/screenshots/${mode}.png`,
    fullPage: true,
  });
  for (const path of [
    'functions/warehouse/settings/warehouses',
    'functions/warehouse/materials/requests',
    'functions/warehouse/materials/history',
    'functions',
    'human-resources',
  ]) {
    await page.goto(`${base}${path}`);
    await page.locator('main h1').waitFor();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  const result = {
    mode,
    base,
    businessWrites: mode === 'staging' ? 'isolated database only' : 'none',
    browserPreferenceWrites: 'current locale persistence only',
    checkedAt: new Date().toISOString(),
    checks,
    pageErrors: errors,
    failedResponses: failures,
  };
  await writeFile(
    `${directory}/${mode}-verification.json`,
    JSON.stringify(result, null, 2) + '\n',
  );
  log(JSON.stringify(result));
} finally {
  if (browser) await browser.close();
  await Promise.all(contexts.map((context) => context.dispose()));
}

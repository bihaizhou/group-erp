import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { log } from 'node:console';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { URL, URLSearchParams } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect, request } from '@playwright/test';

const release = 'purchase-a22-20261018-114728';
const mode = process.env.ERP_DEPLOYMENT_MODE ?? 'production';
assert(
  [
    'legacy',
    'staging',
    'staging-restart',
    'production-before',
    'production',
    'production-restart',
  ].includes(mode),
);
const isolated = !mode.startsWith('production');
if (isolated)
  assert.equal(
    process.env.ERP_VERIFY_DATABASE,
    'group_erp_purchase_release_verify',
  );
const base = isolated
  ? 'http://127.0.0.1:14029/main/'
  : 'http://192.168.5.189:13010/main/';
const directory = `storage/deployments/${release}`;
const privateDirectory = '/tmp/erp-purchase-release';
await mkdir(`${directory}/screenshots`, { recursive: true });
const contexts = [];
async function context(state) {
  const api = await request.newContext({
    extraHTTPHeaders: { Origin: new URL(base).origin },
    ...(state ? { storageState: state } : {}),
  });
  contexts.push(api);
  return api;
}
async function signIn(credentials, username = false) {
  const api = await context();
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await api.post(
      `${base}api/auth/sign-in/${username ? 'username' : 'email'}`,
      { data: credentials },
    );
    if (response.status() !== 429) break;
    const retryAfter = Number(response.headers()['retry-after'] ?? 15);
    assert(
      Number.isFinite(retryAfter) && retryAfter >= 0 && retryAfter <= 60,
      'Bounded server retry-after',
    );
    await delay((retryAfter + 1) * 1000);
  }
  assert.equal(
    response.status(),
    200,
    'Sign-in must preserve the existing account',
  );
  return api;
}
async function get(api, path) {
  const response = await api.get(`${base}api/${path}`);
  assert.equal(response.status(), 200, `GET ${path}`);
  return response.json();
}
async function write(api, path, data, method = 'POST', status) {
  assert(
    isolated && mode !== 'staging-restart',
    'Business writes are permitted only in the guarded isolated fixture phases',
  );
  assert.equal(
    process.env.ERP_VERIFY_DATABASE,
    'group_erp_purchase_release_verify',
  );
  const response = await api.fetch(`${base}api/${path}`, { method, data });
  const body = await response.json();
  assert.equal(
    response.status(),
    status ?? (method === 'POST' ? 201 : 200),
    `${method} ${path}: ${body.error?.reason ?? response.status()}`,
  );
  return response.ok() ? body.data : body.error;
}
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const savePrivate = async (path, value) =>
  writeFile(`${privateDirectory}/${path}`, JSON.stringify(value), {
    mode: 0o600,
  });
const date = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const mutation = (row) => ({
  version: row.revision,
  lifecycleVersion: row.lifecycleVersion,
  requestKey: randomUUID(),
  reason: 'Isolated built-release verification',
});
let browser;
try {
  const anonymous = await context();
  assert.equal((await get(anonymous, 'healthz')).ok, true);
  const credentials = isolated
    ? await json(`${privateDirectory}/stage-secret.json`)
    : await json('deploy/initial-admin.secret.json');
  let root;
  if (mode === 'legacy' || mode === 'production-before') {
    root = await signIn(
      { username: credentials.username, password: credentials.password },
      true,
    );
    await savePrivate(
      isolated ? 'stage-auth.json' : 'production-auth.json',
      await root.storageState(),
    );
  } else {
    root = await context(
      `${privateDirectory}/${isolated ? 'stage' : 'production'}-auth.json`,
    );
  }
  const document = await get(root, 'swagger');
  const checks = [
    'health',
    'authenticated OpenAPI',
    mode.includes('restart')
      ? 'original signed-in session survives restart'
      : 'configured administrator session',
  ];
  let fixture;
  const create = async (path, value) => write(root, path, value);
  async function member(name, roles, company, position) {
    const password = randomUUID(),
      email = `${name}-${randomUUID()}@example.test`;
    const user = await create('users', {
      name: `Isolated ${name}`,
      email,
      password,
      roleScopes: { app: roles },
    });
    const employee = await create('people/employees', {
      code: randomUUID(),
      name: `Isolated ${name}`,
      subjectId: company.id,
      data: { accountId: user.id },
    });
    let change = await create('people/changes', {
      code: randomUUID(),
      name: `Isolated ${name} entry`,
      personId: employee.id,
      data: {
        type: 'entry',
        effectiveDate: date(),
        targetSubjectId: company.id,
        targetPositionId: position.id,
        explanation: 'Isolated release fixture employment',
      },
    });
    for (const transition of ['submit', 'approve'])
      change = await write(
        root,
        `people/changes/${change.id}/fire`,
        {
          transition,
          version: change.lifecycleVersion,
          requestId: randomUUID(),
          reason: 'Isolated approved employment',
          input: {},
        },
        'POST',
        200,
      );
    assert.equal(change.status, 'effective');
    return { user, employee, email, password };
  }
  if (mode === 'legacy') {
    assert(!document.paths['/api/procurement/requests']);
    const company = await create('organization/subjects', {
      code: 'PURCHASE-RELEASE-LEGACY',
      name: '隔离发布公司',
      type: 'group',
    });
    const other = await create('organization/subjects', {
      code: 'PURCHASE-RELEASE-OTHER',
      name: '隔离范围外公司',
      type: 'group',
    });
    const unit = await create('organization/units', {
      code: 'PURCHASE-RELEASE-UNIT',
      name: '隔离采购部门',
      subjectId: company.id,
      type: 'department',
    });
    const position = await create('organization/positions', {
      code: 'PURCHASE-RELEASE-POS',
      name: '隔离采购岗位',
      unitId: unit.id,
    });
    const reviewer = await member(
      'material-reviewer',
      ['materials-reviewer'],
      company,
      position,
    );
    const review = await signIn({
      email: reviewer.email,
      password: reviewer.password,
    });
    const template = await create('materials/templates', {
      name: '发布保留模板',
      fields: [
        {
          key: 'model',
          title: '型号',
          type: 'text',
          identity: true,
          required: true,
        },
      ],
    });
    const name = await create('materials/names', {
      name: '发布保留手套',
      templateId: template.id,
    });
    const units = (await get(root, 'materials/units?pageSize=100')).data;
    const each = units.find((row) => row.code === 'EA'),
      box = units.find((row) => row.code === 'BOX');
    assert(each && box);
    const activate = async (kind, initial) => {
      let row = initial;
      for (const transition of ['submit', 'approve'])
        row = await write(
          transition === 'submit' ? root : review,
          `materials/${kind}/${row.id}/${transition}`,
          {
            version: row.lifecycleVersion,
            requestKey: randomUUID(),
            reason: 'Isolated material qualification',
          },
          'POST',
          200,
        );
      return row;
    };
    const sku = await activate(
      'skus',
      await create('materials/skus', {
        name: '发布保留手套型号',
        materialNameId: name.id,
        baseUnitId: each.id,
        managementMode: 'stock',
        attributeValues: { model: 'release' },
      }),
    );
    const pack = await activate(
      'unitRules',
      await create('materials/unitRules', {
        name: '发布保留包装',
        skuId: sku.id,
        unitId: box.id,
        numerator: '12',
        denominator: '1',
      }),
    );
    const admission = await create('materials/subjectSettings', {
      name: '发布保留准入',
      subjectId: company.id,
      skuId: sku.id,
      canPurchase: true,
      canSell: false,
    });
    fixture = {
      company,
      other,
      unit,
      position,
      reviewer,
      template,
      name,
      each,
      box,
      sku,
      pack,
      admission,
    };
    fixture.legacySnapshot = {};
    for (const [key, path] of Object.entries({
      company: `organization/subjects/${company.id}`,
      unit: `organization/units/${unit.id}`,
      employee: `people/employees/${reviewer.employee.id}`,
      name: `materials/names/${name.id}`,
      sku: `materials/skus/${sku.id}`,
      pack: `materials/unitRules/${pack.id}`,
      admission: `materials/subjectSettings/${admission.id}`,
    }))
      fixture.legacySnapshot[key] = (await get(root, path)).data;
    await savePrivate('stage-fixture.json', fixture);
    checks.push(
      'previous compiled image initialized nonempty organization, effective employment, SKU, packaging and admission',
    );
  } else if (mode === 'production-before') {
    assert(!document.paths['/api/procurement/requests']);
    checks.push('previous live administrator signed in without account reset');
  } else {
    for (const path of [
      '/api/procurement/requests',
      '/api/procurement/settings',
      '/api/procurement/referenceImpacts',
      '/api/procurement/supplierAvailability',
    ])
      assert(document.paths[path], path);
    for (const path of [
      'procurement/requests',
      'procurement/settings/options',
      'procurement/referenceImpacts?domain=organization&kind=subjects&id=' +
        randomUUID(),
    ])
      assert.equal(
        (await anonymous.get(`${base}api/${path}`)).status(),
        401,
        path,
      );
    if (isolated) {
      fixture = await json(`${privateDirectory}/stage-fixture.json`);
      for (const [key, path] of Object.entries({
        company: `organization/subjects/${fixture.company.id}`,
        unit: `organization/units/${fixture.unit.id}`,
        employee: `people/employees/${fixture.reviewer.employee.id}`,
        name: `materials/names/${fixture.name.id}`,
        sku: `materials/skus/${fixture.sku.id}`,
        pack: `materials/unitRules/${fixture.pack.id}`,
        admission: `materials/subjectSettings/${fixture.admission.id}`,
      }))
        assert.deepEqual(
          (await get(root, path)).data,
          fixture.legacySnapshot[key],
          `Legacy ${key} retained exactly`,
        );
      checks.push(
        'nonempty legacy records and stable material identities preserved exactly',
      );
      if (mode === 'staging') {
        const applicant = await member(
          'purchase-applicant',
          ['procurement-requester'],
          fixture.company,
          fixture.position,
        );
        const reviewer = await member(
          'purchase-reviewer',
          ['procurement-request-reviewer'],
          fixture.company,
          fixture.position,
        );
        const owner = await member(
          'maintenance-only',
          ['materials-maintainer'],
          fixture.company,
          fixture.position,
        );
        const applicantApi = await signIn({
          email: applicant.email,
          password: applicant.password,
        });
        const reviewerApi = await signIn({
          email: reviewer.email,
          password: reviewer.password,
        });
        const ownerApi = await signIn({
          email: owner.email,
          password: owner.password,
        });
        await write(
          root,
          'procurement/settings',
          {
            subjectId: fixture.company.id,
            version: (
              await get(
                root,
                `procurement/settings?subjectId=${fixture.company.id}`,
              )
            ).data.revision,
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
          200,
        );
        const supplier = await create('procurement/suppliers', {
          subjectId: fixture.company.id,
          name: '发布隔离供应商',
          code: randomUUID(),
          notes: '',
          requestKey: randomUUID(),
        });
        const materialReview = await signIn({
          email: fixture.reviewer.email,
          password: fixture.reviewer.password,
        });
        const fractionalEach = await create('materials/units', {
          name: `发布小数基础单位-${randomUUID()}`,
          unitType: 'count',
          precision: 3,
        });
        const fractionalBox = await create('materials/units', {
          name: `发布小数包装单位-${randomUUID()}`,
          unitType: 'package',
          precision: 3,
        });
        const activate = async (kind, initial) => {
          let value = initial;
          for (const transition of ['submit', 'approve'])
            value = await write(
              transition === 'submit' ? root : materialReview,
              `materials/${kind}/${value.id}/${transition}`,
              {
                version: value.lifecycleVersion,
                requestKey: randomUUID(),
                reason: 'Isolated decimal qualification',
              },
              'POST',
              200,
            );
          return value;
        };
        const fractionalSku = await activate(
          'skus',
          await create('materials/skus', {
            name: '发布小数物料',
            materialNameId: fixture.name.id,
            baseUnitId: fractionalEach.id,
            managementMode: 'stock',
            attributeValues: { model: randomUUID() },
          }),
        );
        const fractionalRule = await activate(
          'unitRules',
          await create('materials/unitRules', {
            name: '发布小数包装比例',
            skuId: fractionalSku.id,
            unitId: fractionalBox.id,
            numerator: '12',
            denominator: '1',
          }),
        );
        await create('materials/subjectSettings', {
          name: '发布小数准入',
          subjectId: fixture.company.id,
          skuId: fractionalSku.id,
          canPurchase: true,
          canSell: false,
        });
        const known = {
          id: randomUUID(),
          selection: {
            kind: 'known',
            subjectId: fixture.company.id,
            skuId: fixture.sku.id,
            unitId: fixture.box.id,
            unitRuleId: fixture.pack.id,
            quantity: '3',
          },
          originalName: '原始发布手套',
          originalSpecification: '型号release',
          usage: '',
          notes: '',
        };
        const fractional = {
          ...known,
          id: randomUUID(),
          selection: {
            ...known.selection,
            skuId: fractionalSku.id,
            unitId: fractionalBox.id,
            unitRuleId: fractionalRule.id,
            quantity: '3.125',
          },
        };
        const unknown = {
          id: randomUUID(),
          selection: {
            kind: 'unknown',
            subjectId: fixture.company.id,
            originalName: '待治理需求',
            originalSpecification: '保留原始要求',
            requestedUnitText: '项',
            quantity: '9007199254740993.125',
          },
          originalName: '待治理需求',
          originalSpecification: '保留原始要求',
          usage: '',
          notes: '',
        };
        let row = await write(applicantApi, 'procurement/requests', {
          content: {
            subjectId: fixture.company.id,
            requesterEmployeeId: applicant.employee.id,
            requestingUnitId: fixture.unit.id,
            usage: '隔离编译产物采购流程',
            neededOn: date(),
            suggestedSupplierId: supplier.partnerId,
            projectId: null,
            notes: '',
            lines: [known, fractional, unknown],
          },
          requestKey: randomUUID(),
        });
        row = await write(
          applicantApi,
          `procurement/requests/${row.id}/submit`,
          mutation(row),
          'POST',
          200,
        );
        assert.equal(row.status, 'pending');
        assert.equal(row.lines[0].baseQuantity, '36');
        assert.equal(row.lines[1].baseQuantity, '37.5');
        assert.equal(row.lines[2].requestedQuantity, '9007199254740993.125');
        const pending = row;
        row = await write(
          reviewerApi,
          `procurement/requests/${row.id}/approve`,
          mutation(row),
          'POST',
          200,
        );
        assert.equal(row.status, 'approved');
        for (const [domain, kind, id] of [
          ['organization', 'subjects', fixture.company.id],
          ['people', 'employees', applicant.employee.id],
          ['materials', 'skus', fixture.sku.id],
          ['suppliers', 'identity', supplier.partnerId],
        ]) {
          const impact = (
            await get(
              root,
              `procurement/referenceImpacts?${new URLSearchParams({ domain, kind, id })}`,
            )
          ).data;
          assert(impact.items.some((item) => item.id === row.id));
        }
        const hidden = (
          await get(
            ownerApi,
            `procurement/referenceImpacts?domain=materials&kind=skus&id=${fixture.sku.id}`,
          )
        ).data;
        assert.deepEqual(hidden, {
          visibility: 'restricted',
          items: [],
          hasMore: false,
        });
        const outside = await applicantApi.get(
          `${base}api/procurement/requests?subjectId=${fixture.other.id}`,
        );
        await get(root, `procurement/requests?subjectId=${fixture.other.id}`);
        const outsideBody = await outside.json();
        assert(
          [400, 403].includes(outside.status()),
          'Out-of-company filter is rejected',
        );
        assert(
          outsideBody.error?.reason && !outsideBody.data,
          'Scope rejection returns no business records',
        );
        const blocked = await write(
          root,
          `organization/subjects/${fixture.company.id}/setStatus`,
          {
            version: fixture.company.version,
            status: 'inactive',
            reason: 'Isolated reference guard',
          },
          'POST',
          400,
        );
        assert.equal(blocked.reason, 'ORG_PURCHASE_DEPENDENTS');
        await write(
          root,
          `procurement/suppliers/${supplier.id}/deactivate`,
          {
            version: supplier.revision,
            requestKey: randomUUID(),
            reason: 'Isolated supplier coordination',
          },
          'POST',
          200,
        );
        const unchanged = (await get(root, `procurement/requests/${row.id}`))
          .data;
        for (const key of ['versions', 'reviewTasks', 'supplierSnapshot'])
          assert.deepEqual(unchanged[key], row[key]);
        fixture.purchase = unchanged;
        fixture.pending = pending;
        fixture.applicant = applicant;
        fixture.purchaseReviewer = reviewer;
        await savePrivate('stage-fixture.json', fixture);
        checks.push(
          'compiled-image purchase draft -> submit -> independent approval',
          'exact packaging 37.5 and large quantity 9007199254740993.125',
          'ordinary company scopes and maintenance-only opaque reference response',
          'organization guard and supplier stopping preserve frozen purchase history',
        );
      } else {
        assert.deepEqual(
          (await get(root, `procurement/requests/${fixture.purchase.id}`)).data,
          fixture.purchase,
        );
        checks.push(
          'full purchase record, versions, tasks, frozen rules and exact quantities survive application/database restart',
        );
      }
    } else {
      const fresh = await signIn(
        { username: credentials.username, password: credentials.password },
        true,
      );
      const companies = (
        await get(fresh, 'procurement/requestCompanies?pageSize=1')
      ).data;
      await get(root, 'procurement/settings/companies?pageSize=1');
      if (companies.length) {
        await get(
          fresh,
          `procurement/requests?subjectId=${companies[0].id}&pageSize=1`,
        );
        await get(
          root,
          `procurement/settings/options?subjectId=${companies[0].id}&kind=reviewers&pageSize=1`,
        );
      } else
        checks.push(
          'no configured company: original empty setup retained; no test company inserted',
        );
      checks.push(
        'new live sign-in and original session',
        'live procurement authorized reads without sample business writes',
      );
    }
    browser = await chromium.launch({ headless: true });
    const view = await browser.newContext({
        storageState: await root.storageState(),
        viewport: { width: 1440, height: 1000 },
      }),
      page = await view.newPage();
    const errors = [],
      failures = [],
      failed = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('response', (r) => {
      if (r.status() >= 400)
        failures.push({ status: r.status(), path: new URL(r.url()).pathname });
    });
    page.on('requestfailed', (r) => {
      if (!r.failure()?.errorText.includes('ABORTED'))
        failed.push(new URL(r.url()).pathname);
    });
    const company = isolated
      ? fixture.company
      : (await get(root, 'organization/subjects?pageSize=1')).data[0];
    for (const [name, path, title] of [
      ['requests', 'functions/procurement/requests', '采购申请'],
      ['settings', 'functions/procurement/settings', '采购审核配置'],
      ['suppliers', 'functions/procurement/suppliers', '供应商'],
    ]) {
      await page.goto(
        `${base}${path}${company ? `?subjectId=${company.id}` : ''}`,
      );
      await expect(
        page.getByRole('heading', { name: title, exact: true }),
      ).toBeVisible();
      await expect(page.locator('[data-slot=skeleton]')).toHaveCount(0);
      await page.screenshot({
        path: `${directory}/screenshots/${mode}-${name}.png`,
        animations: 'disabled',
      });
      await page.reload();
      await expect(
        page.getByRole('heading', { name: title, exact: true }),
      ).toBeVisible();
    }
    if (isolated) {
      await page.goto(
        `${base}functions/procurement/requests/${fixture.purchase.id}?subjectId=${fixture.company.id}`,
      );
      await expect(
        page.getByText(fixture.purchase.code, { exact: true }).last(),
      ).toBeVisible();
      await page.goto(
        `${base}functions/warehouse/materials/names/edit/${fixture.name.id}`,
      );
      const notice = page.locator('[data-purchase-references]').last();
      await expect(notice.getByText(fixture.purchase.code)).toBeVisible();
      await notice.scrollIntoViewIfNeeded();
      await page.setViewportSize({ width: 375, height: 900 });
      await page.evaluate(() => {
        document.documentElement.classList.add('dark');
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= globalThis.innerWidth,
        ),
      );
      await page.screenshot({
        path: `${directory}/screenshots/${mode}-reference-mobile.png`,
        animations: 'disabled',
      });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
    assert.deepEqual(failed, []);
    checks.push(
      'real built browser pages, lazy assets, API reads and deep-link reload',
      'no introduced browser errors or failed requests',
    );
    await view.close();
  }
  const result = {
    mode,
    verifiedAt: new Date().toISOString(),
    base,
    checks,
    businessWrites:
      isolated && mode !== 'staging-restart'
        ? 'isolated synthetic fixtures only'
        : 0,
  };
  await writeFile(
    `${directory}/${mode}-verification.json`,
    JSON.stringify(result, null, 2) + '\n',
  );
  log(JSON.stringify(result));
} finally {
  await browser?.close();
  await Promise.all(contexts.map((api) => api.dispose()));
}

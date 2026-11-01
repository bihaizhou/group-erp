import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { log } from 'node:console';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';
import { chromium, expect, request } from '@playwright/test';

const mode = process.env.ERP_DEPLOYMENT_MODE ?? 'production';
assert(
  [
    'legacy',
    'staging',
    'staging-restart',
    'production',
    'production-restart',
  ].includes(mode),
);
const isolated = !mode.startsWith('production');
if (isolated)
  assert.equal(
    process.env.ERP_VERIFY_DATABASE,
    'group_erp_materials_tags_verify_20261018',
  );
const base = isolated
  ? 'http://127.0.0.1:14028/main/'
  : 'http://192.168.5.189:13010/main/';
const directory = 'storage/deployments/materials-tags-20261018-043000';
await mkdir(`${directory}/screenshots`, { recursive: true });
const sessions = [];
async function signIn(credentials, username = false) {
  const api = await request.newContext({
    extraHTTPHeaders: { Origin: new URL(base).origin },
  });
  sessions.push(api);
  const response = await api.post(
    `${base}api/auth/sign-in/${username ? 'username' : 'email'}`,
    { data: credentials },
  );
  assert.equal(response.status(), 200, 'Existing account sign-in');
  return api;
}
async function get(api, path) {
  const response = await api.get(`${base}api/${path}`);
  assert.equal(response.status(), 200, `GET ${path}`);
  return response.json();
}
async function write(api, path, data, method = 'POST', status) {
  assert(isolated, 'No business writes outside the isolated test database');
  const response = await api.fetch(`${base}api/${path}`, { method, data });
  assert.equal(
    response.status(),
    status ?? (method === 'POST' ? 201 : 200),
    `${method} ${path}: ${response.status()}`,
  );
  return response.json();
}
let browser;
try {
  const admin = JSON.parse(
    await readFile('deploy/initial-admin.secret.json', 'utf8'),
  );
  const root = await signIn(
    { username: admin.username, password: admin.password },
    true,
  );
  const document = await get(root, 'swagger');
  const checks = ['administrator login', 'authenticated OpenAPI'];
  if (mode === 'legacy') {
    assert(document.paths['/api/materials/categories']);
    const create = async (kind, value) =>
      (await write(root, `materials/${kind}`, value)).data;
    const member = async (name, role) => {
      const email = `${name}-${randomUUID()}@example.test`,
        password = randomUUID();
      await write(root, 'users', {
        name: `Isolated ${name}`,
        email,
        password,
        roleScopes: { app: [role] },
      });
      return { email, password };
    };
    const reviewerCredentials = await member(
      'tag-reviewer',
      'materials-reviewer',
    );
    const readerCredentials = await member('tag-reader', 'materials-reader');
    const reviewer = await signIn(reviewerCredentials);
    const fire = async (kind, row, transition, actor = root) =>
      (
        await write(
          actor,
          `materials/${kind}/${row.id}/${transition}`,
          {
            version: row.lifecycleVersion,
            requestKey: randomUUID(),
            reason: 'Isolated PostgreSQL verification',
          },
          'POST',
          200,
        )
      ).data;
    const rootCategory = await create('categories', {
      name: '隔离验收办公用品',
    });
    const leafCategory = await create('categories', {
      name: '隔离验收书写用品',
      parentId: rootCategory.id,
    });
    const name = await create('names', {
      name: '隔离验收中性笔',
      categoryId: leafCategory.id,
    });
    const units = (await get(root, 'materials/units?pageSize=100')).data;
    const each = units.find((unit) => unit.code === 'EA'),
      box = units.find((unit) => unit.code === 'BOX');
    assert(each && box);
    let sku = await create('skus', {
      name: '隔离验收黑色中性笔',
      materialNameId: name.id,
      baseUnitId: each.id,
      managementMode: 'stock',
      attributeValues: {},
    });
    sku = await fire('skus', sku, 'submit');
    sku = await fire('skus', sku, 'approve', reviewer);
    let packaging = await create('unitRules', {
      name: '隔离验收12支一盒',
      skuId: sku.id,
      unitId: box.id,
      numerator: '12',
      denominator: '1',
    });
    packaging = await fire('unitRules', packaging, 'submit');
    packaging = await fire('unitRules', packaging, 'approve', reviewer);
    const tag = await create('tags', {
      name: rootCategory.name,
      appliesTo: 'both',
    });
    await create('tagLinks', {
      name: 'Existing name tag',
      tagId: tag.id,
      targetKind: 'names',
      targetId: name.id,
    });
    await create('tagLinks', {
      name: 'Existing SKU tag',
      tagId: tag.id,
      targetKind: 'skus',
      targetId: sku.id,
    });
    const group = (
      await write(root, 'organization/subjects', {
        code: 'TAGS-VERIFY-A',
        name: '隔离验收公司A',
        type: 'group',
      })
    ).data;
    const other = (
      await write(root, 'organization/subjects', {
        code: 'TAGS-VERIFY-B',
        name: '隔离验收公司B',
        type: 'group',
      })
    ).data;
    await create('subjectSettings', {
      name: 'Isolated purchase eligibility',
      subjectId: group.id,
      skuId: sku.id,
      canPurchase: true,
      canSell: false,
    });
    await writeFile(
      `${directory}/fixture.json`,
      JSON.stringify(
        {
          rootCategory,
          leafCategory,
          name,
          sku,
          packaging,
          tag,
          each,
          box,
          group,
          other,
        },
        null,
        2,
      ) + '\n',
    );
    await writeFile(
      `${directory}/.credentials.json`,
      JSON.stringify({
        reviewer: reviewerCredentials,
        reader: readerCredentials,
      }),
      { mode: 0o600 },
    );
    log(
      JSON.stringify({
        mode,
        checks: [
          ...checks,
          'legacy hierarchy, name, active SKU and packaging',
          'existing tag and direct plus inherited memberships',
          'two isolated company identities and purchase eligibility',
        ],
        businessWrites: 'isolated only',
      }),
    );
  } else {
    assert(!document.paths['/api/materials/categories']);
    const materialPaths = Object.entries(document.paths).filter(([path]) =>
      path.includes('/materials/'),
    );
    assert(!JSON.stringify(materialPaths).includes('categoryId'));
    assert.equal(
      (await root.get(`${base}api/materials/categories`)).status(),
      404,
    );
    assert.equal(
      (
        await root.get(
          `${base}api/materials/catalog?categoryId=${randomUUID()}`,
        )
      ).status(),
      400,
    );
    const anon = await request.newContext();
    sessions.push(anon);
    assert.equal(
      (await anon.get(`${base}api/materials/catalog`)).status(),
      401,
    );
    assert.equal((await anon.get(`${base}api/swagger`)).status(), 401);
    for (const kind of [
      'names',
      'skus',
      'templates',
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
    await get(root, 'people/employees');
    await get(root, 'organization/subjects');
    checks.push(
      'category endpoints and parameters absent from OpenAPI',
      'anonymous denied',
      'material, people and organization reads',
    );
    let fixture, reader;
    if (isolated) {
      fixture = JSON.parse(await readFile(`${directory}/fixture.json`, 'utf8'));
      const credentials = JSON.parse(
        await readFile(`${directory}/.credentials.json`, 'utf8'),
      );
      reader = await signIn(credentials.reader);
      assert.equal(
        (await reader.get(`${base}api/materials/skus`)).status(),
        403,
      );
      const name = (await get(root, `materials/names/${fixture.name.id}`)).data;
      assert(!Object.hasOwn(name, 'categoryId'));
      assert.equal(name.id, fixture.name.id);
      const sku = (await get(root, `materials/skus/${fixture.sku.id}`)).data;
      assert.equal(sku.materialNameId, fixture.name.id);
      assert.equal(sku.baseUnitId, fixture.each.id);
      assert.equal(sku.code, fixture.sku.code);
      const tags = (await get(root, 'materials/tags?pageSize=100')).data;
      assert(tags.some((tag) => tag.id === fixture.tag.id));
      const converted = tags.filter((tag) => tag.code.startsWith('MIG-'));
      assert.equal(converted.length, 2);
      for (const tag of [...converted, fixture.tag]) {
        for (const [actor, endpoint] of [
          [root, 'skus'],
          [reader, 'catalog'],
        ]) {
          const list = await get(
            actor,
            `materials/${endpoint}?tagId=${tag.id}`,
          );
          assert.equal(list.meta.total, 1);
          assert.deepEqual(
            list.data.map((row) => row.id),
            [fixture.sku.id],
          );
        }
      }
      const detail = (await get(reader, `materials/catalog/${fixture.sku.id}`))
        .data;
      assert.equal(detail.tags.length, 3);
      assert.equal(
        detail.tags.find((tag) => tag.id === fixture.tag.id).inherited,
        false,
      );
      checks.push(
        'PostgreSQL migration preserves material identities and existing tags',
        'ancestor memberships become tags',
        'direct and inherited filtering has no duplicate rows',
        'reader permissions migrated',
      );
      for (const module of ['procurement', 'requisitions']) {
        const list = await get(
          root,
          `${module}/materialOptions?subjectId=${fixture.group.id}`,
        );
        assert.deepEqual(
          list.data.map((row) => row.id),
          [fixture.sku.id],
        );
        const blocked = await get(
          root,
          `${module}/materialOptions?subjectId=${fixture.other.id}`,
        );
        assert.equal(blocked.meta.total, 0);
        assert.equal(
          (
            await reader.get(
              `${base}api/${module}/materialOptions?subjectId=${fixture.group.id}`,
            )
          ).status(),
          403,
        );
        if (mode === 'staging') {
          const selection = (
            await write(
              root,
              `${module}/materialSelections`,
              {
                kind: 'known',
                subjectId: fixture.group.id,
                skuId: fixture.sku.id,
                quantity: '2',
                unitId: fixture.box.id,
                unitRuleId: fixture.packaging.id,
              },
              'POST',
              200,
            )
          ).data;
          assert.equal(selection.baseQuantity, '24');
          assert.equal(selection.unitRuleRevision, fixture.packaging.version);
        }
      }
      checks.push(
        'A2.1 company eligibility, independent action permission and exact packaging preview',
      );
      if (mode === 'staging') {
        const created = (
          await write(root, 'materials/names', { name: '隔离验收无需分类建档' })
        ).data;
        assert(!Object.hasOwn(created, 'categoryId'));
        await write(
          root,
          'materials/names',
          {
            name: 'Must reject former category',
            categoryId: fixture.leafCategory.id,
          },
          'POST',
          400,
        );
        checks.push(
          'create name without category; former category input rejected',
        );
      }
    }
    browser = await chromium.launch();
    const view = await browser.newContext({
      storageState: await root.storageState(),
      viewport: { width: 1440, height: 1000 },
    });
    // Browser verification never saves business forms, including on the build server.
    await view.route('**/api/**', (route) => {
      const req = route.request();
      const preference =
        req.method() === 'PUT' &&
        new URL(req.url()).pathname.endsWith('/api/i18n/locale');
      return ['GET', 'HEAD', 'OPTIONS'].includes(req.method()) || preference
        ? route.continue()
        : route.abort();
    });
    const page = await view.newPage(),
      errors = [],
      failures = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text().slice(0, 800));
    });
    page.on('response', (response) => {
      if (
        response.status() >= 400 &&
        new URL(response.url()).origin === new URL(base).origin
      )
        failures.push({
          status: response.status(),
          path: new URL(response.url()).pathname,
        });
    });
    const path = `${base}functions/warehouse/materials`;
    await page.goto(`${base}functions`);
    const materialEntry = page
      .locator('[data-slot=card]')
      .filter({ has: page.getByText('物料中心', { exact: true }) });
    const warehouseEntry = page
      .locator('[data-slot=card]')
      .filter({ has: page.getByText('仓库管理', { exact: true }) });
    await expect(
      materialEntry.getByRole('button', { name: '进入模块', exact: true }),
    ).toHaveAttribute('href', '/main/functions/warehouse/materials');
    await expect(
      warehouseEntry.getByRole('button', { name: '进入模块', exact: true }),
    ).toHaveAttribute('href', '/main/functions/warehouse/settings/warehouses');
    const materialMenu = page.getByRole('button', {
      name: '物料中心',
      exact: true,
    });
    await expect(materialMenu).toBeAttached();
    assert(
      await materialMenu.evaluate((element) => {
        const parent = element.closest('li')?.parentElement;
        return Boolean(
          parent &&
          [...parent.querySelectorAll('button')].some(
            (button) =>
              button.textContent?.trim() === '仓库管理' &&
              button.closest('li')?.parentElement === parent,
          ),
        );
      }),
      'Material and warehouse menu groups must be siblings',
    );
    await page.screenshot({
      path: `${directory}/screenshots/${mode}-workbench.png`,
      fullPage: true,
    });
    checks.push('separate material-center and warehouse workbench entries');
    await page.goto(`${path}/names/new`);
    await expect(page.locator('#material-form-name')).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: '物料分类', exact: true }),
    ).toHaveCount(0);
    await page
      .locator('[data-slot=route-overlay-content]')
      .evaluate(async (element) => {
        await Promise.all(
          element
            .getAnimations({ subtree: true })
            .filter(
              (animation) =>
                animation.effect?.getTiming().iterations !== Infinity,
            )
            .map((animation) => animation.finished.catch(() => undefined)),
        );
      });
    await page.screenshot({
      path: `${directory}/screenshots/${mode}-name-form.png`,
      fullPage: true,
    });
    const requests = [];
    page.on('request', (req) => {
      if (/\/api\/materials\/(skus|catalog)$/.test(new URL(req.url()).pathname))
        requests.push(req.url());
    });
    await page.goto(`${path}?categoryId=${randomUUID()}&page=3`);
    await expect(
      page.getByText('筛选条件已失效', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '刷新', exact: true }),
    ).toHaveCount(0);
    assert.equal(requests.length, 0);
    const restoredList = page.waitForResponse(
      (response) =>
        response.status() === 200 &&
        /\/api\/materials\/(skus|catalog)$/.test(
          new URL(response.url()).pathname,
        ),
    );
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await restoredList;
    await expect(page).toHaveURL(path);
    await expect(
      page.getByRole('combobox', { name: '标签', exact: true }),
    ).toBeVisible();
    if (isolated)
      await expect(
        page.getByRole('link', { name: fixture.sku.name, exact: true }),
      ).toBeVisible();
    await expect(page.locator('[data-slot=skeleton]')).toHaveCount(0);
    await page.screenshot({
      path: `${directory}/screenshots/${mode}-material-center.png`,
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.getByRole('combobox', { name: '标签', exact: true }),
    ).toBeVisible();
    checks.push(
      'real HTTP name form has no category',
      'retired URL blocks unfiltered requests and recovers',
      'tag filter and deep-link refresh',
    );
    if (isolated) {
      const limited = await browser.newContext({
        storageState: await reader.storageState(),
        viewport: { width: 375, height: 900 },
      });
      const readonly = await limited.newPage();
      readonly.on('pageerror', (error) => errors.push(error.message));
      await readonly.goto(`${path}?tagId=${fixture.tag.id}`);
      await expect(
        readonly.getByRole('link', { name: fixture.sku.name, exact: true }),
      ).toBeVisible();
      await expect(
        readonly.getByRole('button', { name: '新建物料', exact: true }),
      ).toHaveCount(0);
      await readonly.evaluate(() =>
        globalThis.localStorage.setItem(
          'nocobase:main:theme:color-scheme',
          'dark',
        ),
      );
      await readonly.reload();
      await expect(
        readonly.getByRole('link', { name: fixture.sku.name, exact: true }),
      ).toBeVisible();
      assert(
        await readonly.evaluate(
          () => document.documentElement.scrollWidth <= globalThis.innerWidth,
        ),
      );
      await readonly.screenshot({
        path: `${directory}/screenshots/${mode}-reader-mobile-dark.png`,
        fullPage: true,
      });
      await limited.close();
      checks.push('read-only migrated tag filter at 375px in dark mode');
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
    await view.close();
    const result = {
      mode,
      verifiedAt: new Date().toISOString(),
      base,
      checks,
      consoleErrors: errors,
      failedResponses: failures,
      database: isolated
        ? process.env.ERP_VERIFY_DATABASE
        : 'existing build environment',
      businessWrites: isolated && mode === 'staging' ? 'isolated only' : 0,
    };
    await writeFile(
      `${directory}/${mode}-verification.json`,
      JSON.stringify(result, null, 2) + '\n',
    );
    log(JSON.stringify(result));
  }
} finally {
  await browser?.close();
  await Promise.all(sessions.map((session) => session.dispose()));
}

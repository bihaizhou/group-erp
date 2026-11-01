/// <reference lib="dom" />
import { test, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const directory = 'storage/ui-workflow/warehouse-materials';
test.use({
  actionTimeout: 10000,
  viewport: { width: 1440, height: 1000 },
  storageState: `${directory}/auth.json`,
});
test('template create/edit and material submission work without secure-context randomUUID', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, 'randomUUID', {
      value: undefined,
      configurable: true,
    });
  });
  const f = JSON.parse(await readFile(`${directory}/fixture.json`, 'utf8')),
    root = `${f.base}functions/warehouse/materials`,
    name = `HTTP 模板验收 ${Date.now()}`,
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${root}/templates`);
  await page.getByRole('button', { name: '新建属性模板', exact: true }).click();
  const form = page.locator('#material-form');
  await expect(form).toBeVisible();
  await form.getByRole('textbox', { name: /^名称/ }).fill(name);
  await form.getByRole('button', { name: '添加属性', exact: true }).click();
  await form.getByRole('textbox', { name: /^属性标识/ }).fill('size');
  await form.getByRole('textbox', { name: /^显示名称/ }).fill('尺寸');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page).toHaveURL(`${root}/templates`);
  const response = await context.request.get(
    `${f.base}api/materials/templates?q=${encodeURIComponent(name)}`,
  );
  expect(response.ok()).toBe(true);
  const row = (await response.json()).data.find(
    (value: { name: string }) => value.name === name,
  );
  expect(row.fields[0]).toMatchObject({ key: 'size', title: '尺寸' });
  await page.goto(`${root}/templates/edit/${row.id}`);
  await expect(form.getByRole('textbox', { name: /^属性标识/ })).toHaveValue(
    'size',
  );
  await form.getByRole('textbox', { name: /^显示名称/ }).fill('标准尺寸');
  await form
    .getByRole('textbox', { name: /^操作原因/ })
    .fill('验证 HTTP 环境编辑模板');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page).toHaveURL(`${root}/templates`);
  // Keep the shared draft untouched: other tests exercise its conflict recovery.
  const source = await context.request.get(
    `${f.base}api/materials/skus/${f.draftId}`,
  );
  const draft = await context.request.post(`${f.base}api/materials/skus`, {
    headers: { Origin: new URL(f.base).origin },
    data: {
      name: `HTTP 状态操作 ${Date.now()}`,
      materialNameId: f.nameId,
      baseUnitId: (await source.json()).data.baseUnitId,
      managementMode: 'stock',
      attributeValues: { color: '黑色', tip: '9.9' },
    },
  });
  expect(draft.ok()).toBe(true);
  const skuId = (await draft.json()).data.id;
  await page.goto(`${root}/${skuId}/actions/submit`);
  const action = page.locator('[data-slot=route-overlay-content]');
  await expect(action).toBeVisible();
  await action
    .getByRole('textbox', { name: /操作原因/ })
    .fill('验证 HTTP 环境状态操作');
  await action.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect(page).toHaveURL(`${root}/${skuId}`);
  const submitted = await context.request.get(
    `${f.base}api/materials/skus/${skuId}`,
  );
  expect((await submitted.json()).data.status).toBe('pending');
  expect(errors).toEqual([]);
});
test('material maintenance, independent approval, request resolution and a restricted catalog', async ({
  page,
  browser,
  context,
}) => {
  const f = JSON.parse(await readFile(`${directory}/fixture.json`, 'utf8')),
    base = f.base,
    root = 'functions/warehouse/materials',
    screenshots = `${directory}/screenshots`;
  await mkdir(screenshots, { recursive: true });
  page.on('dialog', (dialog) => void dialog.accept());
  const errors: string[] = [],
    failed: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('/api/materials'))
      failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  await page.goto(`${base}${root}`);
  await expect(
    page.getByRole('heading', { name: '物料中心', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: '黑色中性笔 0.5mm', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${screenshots}/materials-list.png`,
    fullPage: true,
  });
  const standardName = `办公耗材（浏览器验收 ${Date.now()}）`;
  // Opening and closing a child dialog keeps the list's search and state filter.
  await page.goto(
    `${base}${root}/names?status=active&q=${encodeURIComponent('办公')}`,
  );
  await page.getByRole('button', { name: '新建标准名称', exact: true }).click();
  const dialog = page.locator('[data-slot=route-overlay-content]');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: /^名称/ }).fill(standardName);
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/names\?status=active&q=/);
  await expect(page.getByRole('link', { name: standardName })).toBeVisible();
  // A new SKU created under its request keeps the source relationship.
  await page.goto(`${base}${root}/requests/${f.requestId}/newSku`);
  const form = page.locator('#material-form');
  await expect(form).toBeVisible();
  await form
    .getByRole('textbox', { name: /^名称/ })
    .fill('黑色中性笔 0.7mm（浏览器验收）');
  await form.getByRole('combobox', { name: '标准名称', exact: true }).click();
  await page
    .getByRole('option', { name: '中性笔 · GEL-PEN', exact: true })
    .click();
  await form.getByRole('combobox', { name: '基本单位', exact: true }).click();
  await page.getByRole('option', { name: '支 · PEN', exact: true }).click();
  await form.getByRole('combobox', { name: '颜色', exact: true }).click();
  await page.getByRole('option', { name: '黑色', exact: true }).click();
  await form
    .getByRole('textbox', { name: '笔尖直径 (mm) *', exact: true })
    .fill('0.7');
  await page.screenshot({
    path: `${screenshots}/sku-create-structured.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${f.requestId}$`));
  await expect(
    page
      .locator('[data-slot=card-content] span')
      .filter({ hasText: '黑色中性笔 0.7mm（浏览器验收）' }),
  ).toBeVisible();
  const result = await context.request.get(
    `${base}api/materials/skus?q=${encodeURIComponent('浏览器验收')}`,
  );
  expect(result.ok()).toBe(true);
  const created = (await result.json()).data[0];
  expect(created).toBeDefined();
  await page.goto(`${base}${root}/${created.id}`);
  await page.getByRole('button', { name: '提交审核', exact: true }).click();
  const action = page.locator('[data-slot=route-overlay-content]');
  await action
    .getByRole('textbox', { name: /操作原因/ })
    .fill('浏览器验收提交');
  await action.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect(
    page.locator('[data-slot=route-overlay-content]'),
  ).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: '审核启用', exact: true }),
  ).toHaveCount(0);
  const reviewer = await browser.newContext({
    storageState: `${directory}/auth-reviewer.json`,
    viewport: { width: 1440, height: 1000 },
  });
  const reviewPage = await reviewer.newPage();
  reviewPage.on('pageerror', (e) => errors.push(e.message));
  await reviewPage.goto(`${base}${root}/${created.id}`);
  await reviewPage
    .getByRole('button', { name: '审核启用', exact: true })
    .click();
  await reviewPage
    .locator('[data-slot=route-overlay-content]')
    .getByRole('textbox', { name: /操作原因/ })
    .fill('独立审核规格与单位');
  await reviewPage
    .locator('[data-slot=route-overlay-content]')
    .getByRole('button', { name: '审核启用', exact: true })
    .click();
  await expect(
    reviewPage.locator('[data-slot=route-overlay-content]'),
  ).not.toBeVisible();
  await expect(
    reviewPage.getByRole('heading', { name: created.name, exact: true }),
  ).toBeVisible();
  await reviewPage.screenshot({
    path: `${screenshots}/sku-approved.png`,
    fullPage: true,
  });
  await reviewPage.goto(`${base}${root}/requests/${f.requestId}`);
  await reviewPage
    .getByRole('button', { name: '关联 SKU 并办结', exact: true })
    .click();
  const resolve = reviewPage.locator('[data-slot=route-overlay-content]');
  await resolve
    .getByRole('combobox', { name: '办理结果 SKU', exact: true })
    .click();
  await reviewPage
    .getByRole('option', { name: new RegExp('黑色中性笔 0.7mm') })
    .click();
  await resolve
    .getByRole('textbox', { name: /操作原因/ })
    .fill('已关联审核通过的物料');
  await resolve
    .getByRole('button', { name: '关联 SKU 并办结', exact: true })
    .click();
  await expect(resolve).not.toBeVisible();
  await expect(
    reviewPage.locator('dl').getByText('已办结', { exact: true }),
  ).toBeVisible();
  await reviewPage.screenshot({
    path: `${screenshots}/request-resolved.png`,
    fullPage: true,
  });
  await reviewer.close();
  const reader = await browser.newContext({
      storageState: `${directory}/auth-reader.json`,
      viewport: { width: 1440, height: 1000 },
    }),
    catalog = await reader.newPage();
  catalog.on('pageerror', (e) => errors.push(e.message));
  await catalog.goto(`${base}${root}?q=${encodeURIComponent('签字笔')}`);
  await expect(
    catalog.getByText('找到多个候选物料，请查看具体规格和单位后选择。'),
  ).toBeVisible();
  await expect(
    catalog.getByRole('button', { name: '新建物料 SKU' }),
  ).toHaveCount(0);
  await catalog.screenshot({
    path: `${screenshots}/catalog-reader.png`,
    fullPage: true,
  });
  await catalog
    .getByRole('link', { name: '黑色中性笔 0.5mm', exact: true })
    .click();
  await expect(catalog.getByText('每盒 12 支', { exact: false })).toBeVisible();
  await expect(
    catalog.getByRole('button', { name: '编辑', exact: true }),
  ).toHaveCount(0);
  await catalog.screenshot({
    path: `${screenshots}/catalog-detail.png`,
    fullPage: true,
  });
  const denied = await reader.request.get(
    `${base}api/materials/skus/${created.id}`,
  );
  expect(denied.status()).toBe(403);
  await reader.close();
  await page.goto(`${base}${root}/templates/new`);
  await page.getByRole('button', { name: '添加属性', exact: true }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: `${screenshots}/template-mobile.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto(`${base}${root}/tags/new`);
  await expect(
    page
      .locator('[data-slot=route-overlay-content]')
      .getByRole('button', { name: '创建', exact: true }),
  ).toBeEnabled();
  await page.waitForTimeout(220);
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.dataset.theme = 'default';
    localStorage.setItem('nocobase:main:theme:color-scheme', 'dark');
    localStorage.setItem('nocobase:main:theme:preset', 'default');
  });
  await page.screenshot({
    path: `${screenshots}/tag-dialog-mobile-dark.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}${root}/history`);
  await expect(
    page.getByRole('heading', { name: '治理记录', exact: true }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('[data-slot=card]').first()).toBeVisible();
  await page.waitForTimeout(220);
  await page.screenshot({
    path: `${screenshots}/history-dark.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
  await writeFile(
    `${screenshots}/browser-results.json`,
    JSON.stringify(
      {
        errors,
        failed,
        createdSkuId: created.id,
        flows: [
          'standard name create without category',
          'source request SKU create',
          'independent approval',
          'request resolution',
          'restricted alias catalog',
          'detail',
          'mobile template',
          'dark dialog',
          'history',
        ],
      },
      null,
      2,
    ),
  );
});

test('catalog filters, missing material guidance, history and complete detail refresh', async ({
  page,
  browser,
  context,
}) => {
  const f = JSON.parse(await readFile(`${directory}/fixture.json`, 'utf8')),
    root = `${f.base}functions/warehouse/materials`;
  const reader = await browser.newContext({
    storageState: `${directory}/auth-reader.json`,
  });
  const catalog = await reader.newPage();
  await catalog.goto(`${root}?q=${encodeURIComponent('中性笔')}`);
  await expect(catalog.getByText(/匹配标准名称：中性笔/)).toBeVisible();
  const sorted = catalog.waitForResponse((r) => {
    const url = new URL(r.url());
    return (
      url.pathname.endsWith('/api/materials/catalog') &&
      url.searchParams.get('orderBy') === 'updatedAt'
    );
  });
  await catalog.getByRole('button', { name: /更新时间/ }).click();
  const ascending = (await (await sorted).json()).data as {
    name: string;
    updatedAt: string;
  }[];
  expect(ascending.length).toBeGreaterThan(1);
  expect(ascending.map((row) => row.updatedAt)).toEqual(
    ascending.map((row) => row.updatedAt).sort(),
  );
  await expect(
    catalog.locator('tbody tr').first().getByRole('link'),
  ).toHaveText(ascending[0].name);
  await catalog.screenshot({
    path: `${directory}/screenshots/catalog-reader.png`,
    fullPage: true,
  });
  await catalog.getByRole('combobox', { name: '标签', exact: true }).click();
  await catalog.getByRole('option', { name: '日常办公', exact: true }).click();
  await expect(catalog).toHaveURL(new RegExp(`tagId=${f.tagId}`));
  await catalog.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(catalog).not.toHaveURL(/tagId=|q=/);
  await catalog.goto(`${root}?q=UNMATCHED-MATERIAL`);
  await expect(
    catalog.getByText('找不到所需物料时，请联系物料维护人员。'),
  ).toBeVisible();
  await expect(
    catalog.getByRole('button', { name: '提报缺失物料', exact: true }),
  ).toHaveCount(0);
  await reader.close();

  await page.goto(`${root}?q=UNMATCHED-MATERIAL`);
  await page.getByRole('button', { name: '提报缺失物料', exact: true }).click();
  await expect(page.locator('#material-form-usage')).toBeVisible();
  await expect(page).toHaveURL(/newRequest\?q=UNMATCHED-MATERIAL/);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page).toHaveURL(`${root}?q=UNMATCHED-MATERIAL`);

  await page.goto(`${root}/${f.skuId}`);
  const detail = page.locator('[data-slot=route-child-page]').last();
  await expect(
    detail.getByRole('heading', { name: '黑色中性笔 0.5mm', exact: true }),
  ).toBeVisible();
  await expect(detail.getByText(/^日常办公/)).toBeVisible();
  const refreshed: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET')
      refreshed.push(new URL(request.url()).pathname);
  });
  await detail.getByRole('button', { name: '刷新', exact: true }).click();
  await expect
    .poll(() => refreshed.some((url) => url.endsWith(`/skus/${f.skuId}`)))
    .toBe(true);
  await expect
    .poll(() => refreshed.some((url) => url.endsWith('/materials/options')))
    .toBe(true);
  await expect
    .poll(() => refreshed.some((url) => url.endsWith(`/catalog/${f.skuId}`)))
    .toBe(true);

  await page.goto(
    `${root}/history?kind=skus&q=${encodeURIComponent('中性笔')}`,
  );
  await page
    .getByRole('combobox', { name: '记录时间排序', exact: true })
    .click();
  await page.getByRole('option', { name: '最早记录在前', exact: true }).click();
  await expect(page).toHaveURL(/orderBy=createdAt/);
  await expect(
    page.getByText('首次建立资料', { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page).not.toHaveURL(/kind=|q=/);

  await page.goto(`${root}/tags/new`);
  const name = page.locator('#material-form-name');
  await name.pressSequentially('AB');
  await name.press('Home');
  await name.press('ArrowRight');
  await page.keyboard.type('1');
  await expect(name).toHaveValue('A1B');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', {
    text: 'biaoqian',
    selectionStart: 8,
    selectionEnd: 8,
  });
  await cdp.send('Input.insertText', { text: '标签' });
  await expect(name).toHaveValue('A1标签B');
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '取消', exact: true }).click();
  const discard = page.getByRole('alertdialog', { name: '放弃未保存的修改？' });
  await discard.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(name).toHaveValue('A1标签B');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await discard.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page).toHaveURL(`${root}/tags`);
});

test('loading failures, 404, English forms, keyboard and Chinese composition', async ({
  page,
  context,
}) => {
  const f = JSON.parse(await readFile(`${directory}/fixture.json`, 'utf8')),
    root = `${f.base}functions/warehouse/materials`,
    shots = `${directory}/screenshots`;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/materials/skus?*', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 500,
          status: 'INTERNAL',
          reason: 'INTERNAL_ERROR',
          domain: 'app',
          message: 'Controlled verification failure',
        },
      }),
    }),
  );
  await page.goto(`${root}?q=failed`);
  await expect(
    page.getByRole('button', { name: '重试', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${shots}/list-failure.png`, fullPage: true });
  await page.unroute('**/api/materials/skus?*');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('没有匹配结果', { exact: true })).toBeVisible();
  await page.goto(`${root}/00000000-0000-4000-8000-000000000999`);
  await expect(
    page.getByText('资料不存在或不可访问。', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '重试', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: `${shots}/detail-404.png`, fullPage: true });
  await page.goto(root);
  const search = page.getByPlaceholder('搜索名称、编码或规格'),
    queries: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/api/materials/skus'))
      queries.push(url.searchParams.get('q') ?? '');
  });
  await search.click();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', {
    text: 'zhongxing',
    selectionStart: 8,
    selectionEnd: 8,
  });
  await page.waitForTimeout(400);
  expect(queries).not.toContain('zhongxing');
  await cdp.send('Input.insertText', { text: '中性' });
  await expect(page).toHaveURL(/q=/);
  await expect(
    page.getByRole('link', { name: '黑色中性笔 0.5mm', exact: true }),
  ).toBeVisible();
  await page.goto(`${root}/tags/new`);
  const popup = page.locator('[data-slot=route-overlay-content]');
  await expect(popup).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popup).not.toBeVisible();
  await expect(page).toHaveURL(/\/tags$/);
  await page.getByRole('button', { name: '打开账户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: /语言/ }).hover();
  await page.getByRole('menuitemradio', { name: /English/ }).click();
  await page.goto(`${root}/tags/new`);
  await expect(
    page
      .locator('[data-slot=route-overlay-content]')
      .getByRole('heading', { name: 'New Tags', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.dataset.theme = 'default';
    localStorage.setItem('nocobase:main:theme:color-scheme', 'dark');
    localStorage.setItem('nocobase:main:theme:preset', 'default');
  });
  await expect(
    page
      .locator('[data-slot=route-overlay-content]')
      .getByRole('button', { name: 'Create', exact: true }),
  ).toBeEnabled();
  await page.waitForTimeout(220);
  await page.screenshot({
    path: `${shots}/tag-dialog-en-mobile-dark.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('review fixes preserve nested context, conflict input, focus and narrow options', async ({
  page,
}) => {
  const f = JSON.parse(await readFile(`${directory}/fixture.json`, 'utf8')),
    root = `${f.base}functions/warehouse/materials`,
    shots = `${directory}/screenshots`,
    popup = page.locator('[data-slot=route-overlay-content]');
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto(`${root}/requests/${f.requestId}?status=resolved`);
  await page
    .getByRole('button', { name: '查看详情', exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/requests\/.*\/skus\/.*\?status=resolved/);
  const nested = page.url();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.locator('#material-form')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page).toHaveURL(nested);
  await expect(page.locator('#material-form')).toHaveCount(0);
  await page
    .locator('[data-slot=route-child-page]')
    .last()
    .getByRole('link', { name: '返回', exact: true })
    .click();
  await expect(page).toHaveURL(
    `${root}/requests/${f.requestId}?status=resolved`,
  );
  await page.goto(`${root}/names/new`);
  await page.locator('#material-form-name').fill('唯一冲突修正验收');
  await page.locator('#material-form-code').fill('EXISTING');
  await page.route('**/api/materials/names', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 409,
              status: 'ALREADY_EXISTS',
              reason: 'MATERIAL_CODE_EXISTS',
              domain: 'materials',
              message: 'Conflict',
              fieldViolations: [{ field: 'code', description: 'Conflict' }],
            },
          }),
        })
      : route.continue(),
  );
  await popup.getByRole('button', { name: '创建', exact: true }).click();
  await expect(
    popup.getByRole('button', { name: '创建', exact: true }),
  ).toBeEnabled();
  await expect(
    popup.getByRole('button', { name: '重新加载最新资料' }),
  ).toHaveCount(0);
  await page.locator('#material-form-code').fill(`FIX-${Date.now()}`);
  await page.unroute('**/api/materials/names');
  await popup.getByRole('button', { name: '创建', exact: true }).click();
  await expect(popup).toHaveCount(0);
  await page.goto(`${root}/${f.draftId}/actions/submit`);
  await popup.locator('#material-action-reason').fill('版本冲突后保留原因');
  await page.route(`**/api/materials/skus/${f.draftId}/submit`, (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 409,
          status: 'ABORTED',
          reason: 'MATERIAL_VERSION_CONFLICT',
          domain: 'materials',
          message: 'Conflict',
        },
      }),
    }),
  );
  await popup.getByRole('button', { name: '提交审核', exact: true }).click();
  await popup
    .getByRole('button', { name: '重新加载最新资料', exact: true })
    .click();
  await expect(popup.locator('#material-action-reason')).toHaveValue(
    '版本冲突后保留原因',
  );
  await expect(
    popup.getByRole('button', { name: '提交审核', exact: true }),
  ).toBeEnabled();
  await page.unroute(`**/api/materials/skus/${f.draftId}/submit`);
  await popup.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect(popup).toHaveCount(0);
  await page.goto(`${root}/templates/new`);
  await page.locator('#material-form-name').fill('模板焦点验收');
  await page.getByRole('button', { name: '添加属性', exact: true }).click();
  await expect(page.locator('#attribute-0-key')).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.locator('#attribute-0-key')).toBeFocused();
  await page.locator('#attribute-0-key').fill('size');
  await page.locator('#attribute-0-title').fill('尺寸');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: `${shots}/template-mobile.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page).toHaveURL(`${root}/templates`);
  await page.route('**/api/materials/options?*', async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    if (body.data?.skus?.rows?.length)
      body.data.skus.rows[0].name =
        '超长规格名称用于验证窄屏选项不会裁切、能够自动换行并保持全部文字可见';
    await route.fulfill({ response, json: body });
  });
  await page.goto(`${root}/unitRules/new`);
  await popup.getByRole('combobox', { name: '物料 SKU', exact: true }).click();
  const option = page.getByRole('option', { name: /超长规格名称/ });
  await expect(option).toBeVisible();
  const measurement = await option
    .locator(':scope > :first-child')
    .evaluate((node) => ({
      whiteSpace: getComputedStyle(node).whiteSpace,
      width: node.clientWidth,
      popup: node.closest('[data-slot=select-content]')?.clientWidth ?? 0,
    }));
  expect(measurement.whiteSpace).toBe('normal');
  expect(measurement.width).toBeLessThanOrEqual(measurement.popup);
  await page.screenshot({
    path: `${shots}/long-option-mobile.png`,
    fullPage: true,
  });
  await writeFile(
    `${shots}/review-rechecks.json`,
    JSON.stringify(
      {
        nested: true,
        uniqueConflict: true,
        actionConflict: true,
        attributeFocus: true,
        longOption: measurement,
      },
      null,
      2,
    ),
  );
});

/// <reference lib="dom" />
import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const dir = 'storage/ui-workflow/procurement-requests',
  shots = `${dir}/screenshots`;
interface Fixture {
  base: string;
  companyId: string;
  otherCompanyId: string;
  emptyCompanyId: string;
  employeeId: string;
  unitId: string;
  reviewerId: string;
  pendingId: string;
  approvedId: string;
  cancelledId: string;
  mixedId: string;
  skuId: string;
  boxId: string;
  pack12Id: string;
  pack24Id: string;
}
const fixture = async () =>
  JSON.parse(await readFile(`${dir}/fixture.json`, 'utf8')) as Fixture;
test.use({
  storageState: `${dir}/auth-applicant.json`,
  viewport: { width: 1440, height: 1000 },
  actionTimeout: 15000,
});
interface Capture {
  name: string;
  pageErrors: string[];
  consoleErrors: string[];
  http: { status: number; path: string }[];
  failed: { path: string; error: string }[];
}
let currentCapture: Capture[] = [];
const allCaptures: {
  test: string;
  status: string | undefined;
  pages: Capture[];
}[] = [];
function observe(page: Page, name: string) {
  const capture: Capture = {
    name,
    pageErrors: [],
    consoleErrors: [],
    http: [],
    failed: [],
  };
  currentCapture.push(capture);
  page.on('pageerror', (e) => capture.pageErrors.push(e.message));
  page.on('console', (message) => {
    if (message.type() === 'error') capture.consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400)
      capture.http.push({
        status: response.status(),
        path: new URL(response.url()).pathname,
      });
  });
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText ?? '';
    if (!error.includes('ABORTED'))
      capture.failed.push({ path: new URL(request.url()).pathname, error });
  });
}
test.beforeEach(async ({ page }) => {
  currentCapture = [];
  observe(page, 'default');
});
test.afterEach(async ({ page: _page }, info) => {
  const intentional = info.title.includes('409 review')
    ? [409, 500]
    : info.title.includes('401, 403')
      ? [401, 403, 404, 500]
      : [];
  for (const capture of currentCapture) {
    expect(capture.pageErrors).toEqual([]);
    expect(capture.http.filter((v) => !intentional.includes(v.status))).toEqual(
      [],
    );
    expect(
      capture.consoleErrors.filter(
        (value) =>
          !(intentional.length && value.startsWith('Failed to load resource:')),
      ),
    ).toEqual([]);
    if (!info.title.includes('network failures'))
      expect(capture.failed).toEqual([]);
  }
  allCaptures.push({
    test: info.title,
    status: info.status,
    pages: currentCapture,
  });
  await mkdir(shots, { recursive: true });
  await writeFile(
    `${shots}/capture-log.json`,
    JSON.stringify({ schemaVersion: 1, tests: allCaptures }, null, 2),
  );
});
const take = async (page: Page, name: string) => {
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/${name}.png` });
};
const liveForm = (page: Page) => page.locator('#purchase-request-form');
async function detailLayout(page: Page) {
  const pane = page.locator('[data-slot=route-child-page]').last();
  const boxes = await pane.locator('h1, button').evaluateAll((elements) =>
    elements
      .filter((element) => element.getBoundingClientRect().width > 0)
      .map((element) => {
        const { left, right } = element.getBoundingClientRect();
        return { left, right, viewport: window.innerWidth };
      }),
  );
  expect(boxes.length).toBeGreaterThan(1);
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.viewport);
  }
  expect(
    (await pane.getByRole('heading', { level: 1 }).boundingBox())?.width,
  ).toBeGreaterThan(200);
}
async function action(
  page: Page,
  label: string,
  reason: string,
  destructive = false,
) {
  await page.getByRole('button', { name: label, exact: true }).click();
  const dialog = page.locator('[data-slot=route-overlay-content]');
  await dialog.getByRole('textbox', { name: /办理原因/ }).fill(reason);
  await dialog.locator('button[type=submit]').click();
  if (destructive) {
    const confirm = page.getByRole('alertdialog');
    await confirm
      .getByRole('button', { name: `确认${label}`, exact: true })
      .click();
  }
  await expect(page.locator('[data-slot=route-overlay-content]')).toHaveCount(
    0,
  );
}
test('creates mixed demand with exact packaging and completes independent review on HTTP', async ({
  page,
  browser,
  context,
}) => {
  const f = await fixture(),
    root = `${f.base}functions/procurement/requests`,
    errors: string[] = [],
    term = `browser-mixed-${Date.now()}`;
  page.on('pageerror', (e) => errors.push(e.message));
  await context.addInitScript(() =>
    Object.defineProperty(Crypto.prototype, 'randomUUID', {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto(f.base);
  await expect(
    page.getByRole('heading', { name: '集团 ERP', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '进入模块', exact: true }),
  ).toBeVisible();
  await take(page, 'baseline');
  const baseline = errors.splice(0);
  await page.goto(`${root}?subjectId=${f.companyId}&q=${term}`);
  await expect(page.getByText('没有匹配的申请', { exact: true })).toBeVisible();
  await take(page, 'list-filtered');
  await page.getByRole('button', { name: '新建采购申请', exact: true }).click();
  const form = liveForm(page);
  await expect(form.getByRole('textbox', { name: /用途/ })).toBeVisible();
  await form.getByRole('radio', { name: /采购申请人（验收）/ }).click();
  await form.getByRole('radio', { name: /设备保障部/ }).click();
  await form
    .getByRole('textbox', { name: /用途/ })
    .pressSequentially(`${term} equipment maintenance`);
  await form.getByRole('button', { name: '需求日期', exact: true }).click();
  const day = await page.evaluate(() => new Date().toLocaleDateString('zh-CN'));
  await page.locator(`button[data-day="${day}"]`).first().click();
  await form.getByRole('button', { name: '添加明细', exact: true }).click();
  let line = form.getByRole('group', { name: '明细1', exact: true });
  await line.getByRole('radio', { name: '已有物料', exact: true }).click();
  await line.getByRole('button', { name: '选择物料', exact: true }).click();
  const dialog = page.locator('[data-slot=route-overlay-content]');
  await dialog.getByRole('radio', { name: /耐磨手套/ }).click();
  await dialog.getByRole('combobox', { name: '具体包装', exact: true }).click();
  await page.getByRole('option', { name: /每箱12件/ }).click();
  await dialog.getByRole('textbox', { name: /需求数量/ }).fill('2');
  await expect(dialog.getByText(/基准需求量: 24/)).toBeVisible();
  await take(page, 'material-packaging');
  await dialog.getByRole('button', { name: '使用', exact: true }).click();
  await expect(page.locator('[data-slot=route-overlay-content]')).toHaveCount(
    0,
  );
  await expect(line.getByRole('textbox', { name: /需求数量/ })).toHaveValue(
    '2',
  );
  await expect(
    line.getByRole('button', { name: '选择物料', exact: true }),
  ).toBeFocused();
  await form.getByRole('button', { name: '添加明细', exact: true }).click();
  line = form.getByRole('group', { name: '明细2', exact: true });
  await line
    .getByRole('textbox', { name: '原始名称 *', exact: true })
    .fill('现场旧阀门');
  await line
    .getByRole('textbox', { name: '原始规格 *', exact: true })
    .fill('耐压高温，需核对具体型号');
  await line
    .getByRole('textbox', { name: '单位文字 *', exact: true })
    .fill('套');
  await line
    .getByRole('textbox', { name: '需求数量 *', exact: true })
    .fill('3.125');
  await take(page, 'unknown-line');
  await take(page, 'mixed-lines');
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/procurement/requests') &&
      r.request().method() === 'POST',
  );
  await form.getByRole('button', { name: '保存草稿', exact: true }).click();
  const created = (await (await response).json()).data;
  expect(created.lines[0].baseQuantity).toBe('24');
  expect(created.lines[1].requestedQuantity).toBe('3.125');
  await expect(page).toHaveURL(`${root}?subjectId=${f.companyId}&q=${term}`);
  await page.getByRole('link', { name: created.code, exact: true }).click();
  await action(page, '提交', 'Submit isolated browser request');
  await expect(page.getByText('待审核', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: '撤回', exact: true }),
  ).toBeEnabled();
  await detailLayout(page);
  await take(page, 'pending');
  await page.setViewportSize({ width: 375, height: 812 });
  await detailLayout(page);
  await take(page, 'pending-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const reviewer = await browser.newContext({
      storageState: `${dir}/auth-reviewer.json`,
      viewport: { width: 1440, height: 1000 },
    }),
    reviewPage = await reviewer.newPage();
  observe(reviewPage, 'reviewer');
  reviewPage.on('pageerror', (e) => errors.push(e.message));
  await reviewPage.goto(`${root}/${created.id}?subjectId=${f.companyId}`);
  await action(reviewPage, '批准', 'Reviewed frozen demand');
  await expect(
    reviewPage.getByText('已批准', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    reviewPage.getByText('仍有未识别', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    reviewPage.getByText('当前状态无法办理此操作，请核对最新资料。', {
      exact: true,
    }),
  ).toHaveCount(2);
  await detailLayout(reviewPage);
  await take(reviewPage, 'approved-unidentified');
  await reviewPage
    .getByRole('link', { name: /查看提交版本/ })
    .first()
    .click();
  await expect(
    reviewPage.getByRole('heading', { name: /提交版本/ }),
  ).toBeVisible();
  await take(reviewPage, 'version-history');
  await reviewer.close();
  expect(errors).toEqual([]);
  await writeFile(
    `${shots}/core-log.json`,
    JSON.stringify(
      {
        baseline,
        errors,
        requestId: created.id,
        quantities: ['24', '3.125'],
        flow: [
          'create mixed',
          'submit',
          'independent approval',
          'frozen version',
        ],
      },
      null,
      2,
    ),
  );
});
test('preserves dirty input and filtered list through nested selection, cancellation and sidebar navigation', async ({
  page,
}) => {
  const f = await fixture(),
    root = `${f.base}functions/procurement/requests`,
    url = `${root}?subjectId=${f.companyId}&q=dirty-guard`;
  await page.goto(url);
  await page.getByRole('button', { name: '新建采购申请', exact: true }).click();
  const form = liveForm(page);
  await form
    .getByRole('textbox', { name: /用途/ })
    .pressSequentially('kept input');
  await page.getByRole('link', { name: '职能工作台', exact: true }).click();
  let confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(form.getByRole('textbox', { name: /用途/ })).toHaveValue(
    'kept input',
  );
  await form.getByRole('button', { name: '添加明细', exact: true }).click();
  const line = form.getByRole('group', { name: '明细1', exact: true });
  await line.getByRole('radio', { name: '已有物料', exact: true }).click();
  await line.getByRole('button', { name: '选择物料', exact: true }).click();
  await expect(page.locator('[data-slot=route-overlay-content]')).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await expect(form.getByRole('textbox', { name: /用途/ })).toHaveValue(
    'kept input',
  );
  await page.getByRole('link', { name: '返回', exact: true }).click();
  confirm = page.getByRole('alertdialog');
  await confirm.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page).toHaveURL(url);
  await expect(
    page.getByRole('textbox', { name: '搜索单号、用途或备注', exact: true }),
  ).toBeFocused();
});
test('supports reason validation, 409 review and same-key retries while keeping inputs', async ({
  page,
  context,
}) => {
  const f = await fixture(),
    root = `${f.base}functions/procurement/requests`;
  await page.goto(
    `${root}/${f.mixedId}/edit?subjectId=${f.companyId}&q=conflict`,
  );
  const form = liveForm(page);
  await expect(form.getByRole('textbox', { name: /修改原因/ })).toBeVisible();
  await form
    .getByRole('textbox', { name: /用途/ })
    .fill(`Local revised use ${Date.now()}`);
  await form
    .getByRole('textbox', { name: /修改原因/ })
    .fill('Local explanation');
  const endpoint = `${f.base}api/procurement/requests/${f.mixedId}`,
    latest = (await (await context.request.get(endpoint)).json()).data;
  const content = {
    subjectId: latest.subjectId,
    requesterEmployeeId: latest.requesterEmployeeId,
    requestingUnitId: latest.requestingUnitId,
    usage: 'Remote revised use',
    neededOn: latest.neededOn,
    suggestedSupplierId: latest.suggestedSupplierId,
    projectId: null,
    notes: 'Remote notes retained',
    lines: latest.lines
      .filter((l: { status: string }) => l.status === 'active')
      .map((l: { selectionInput: unknown }) => l.selectionInput),
  };
  const changed = await context.request.patch(endpoint, {
    headers: { Origin: new URL(f.base).origin },
    data: {
      content,
      version: latest.revision,
      lifecycleVersion: latest.lifecycleVersion,
      requestKey: crypto.randomUUID(),
      reason: 'Isolated concurrent editor',
    },
  });
  expect(changed.ok()).toBe(true);
  await form.getByRole('button', { name: '保存', exact: true }).click();
  await expect(
    form.getByText('资料已更新，请核对后再保存。', { exact: true }),
  ).toBeVisible();
  await form.getByRole('button', { name: '核对最新版本', exact: true }).click();
  await form
    .getByRole('radio', { name: /保留本地值: Local revised use/ })
    .click();
  await take(page, 'conflict');
  await form
    .getByRole('button', { name: '应用已核对合并', exact: true })
    .click();
  await expect(
    form.getByRole('textbox', { name: '备注', exact: true }),
  ).toHaveValue('Remote notes retained');
  let fail = true;
  const keys: string[] = [];
  await page.route(
    `**/api/procurement/requests/${f.mixedId}`,
    async (route) => {
      if (route.request().method() === 'PATCH') {
        keys.push(route.request().postDataJSON().requestKey);
        if (fail) {
          fail = false;
          return route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                status: 'INTERNAL',
                reason: 'SIMULATED_FAILURE',
                message: 'isolated',
              },
            }),
          });
        }
      }
      return route.continue();
    },
  );
  await form.getByRole('button', { name: '保存', exact: true }).click();
  await expect(
    form.getByText('请求未完成，请重试；输入已保留。', { exact: true }),
  ).toBeVisible();
  await expect(form.getByRole('textbox', { name: /修改原因/ })).toHaveValue(
    'Local explanation',
  );
  await form.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page).toHaveURL(
    `${root}/${f.mixedId}?subjectId=${f.companyId}&q=conflict`,
  );
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

test('uses complete company settings with separate configuration and page-only permissions', async ({
  browser,
}) => {
  const f = await fixture(),
    context = await browser.newContext({
      storageState: `${dir}/auth-configurator.json`,
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage(),
    errors: string[] = [];
  observe(page, 'configurator');
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${f.base}functions`);
  await expect(
    page.getByRole('button', { name: '进入模块', exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByText('采购审核配置', { exact: true }).last(),
  ).toBeVisible();
  await page.goto(
    `${f.base}functions/procurement/settings?subjectId=${f.companyId}`,
  );
  await expect(page.getByText(/采购审核人（验收）/).first()).toBeVisible();
  await expect(
    page.getByRole('radio', { name: /采购审核人（验收）/ }),
  ).toBeVisible();
  await take(page, 'settings');
  await page
    .getByRole('combobox', { name: '审核与物料识别', exact: true })
    .click();
  await page
    .getByRole('option', { name: '先确认全部物料', exact: true })
    .click();
  const before = (
    await (
      await context.request.get(
        `${f.base}api/procurement/settings?subjectId=${f.companyId}`,
      )
    ).json()
  ).data;
  expect(before.values.allowParallelGovernance).toBe(true);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(
    page.getByText('已保存本公司审核规则', { exact: true }),
  ).toBeVisible();
  const after = (
    await (
      await context.request.get(
        `${f.base}api/procurement/settings?subjectId=${f.companyId}`,
      )
    ).json()
  ).data;
  expect(after.values.allowParallelGovernance).toBe(false);
  await page
    .getByRole('combobox', { name: '审核与物料识别', exact: true })
    .click();
  await page.getByRole('option', { name: '允许并行审核', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(
    page.getByText(`当前规则版本${after.revision + 1}`),
  ).toBeVisible();
  expect(
    (
      await context.request.get(
        `${f.base}api/procurement/requests?subjectId=${f.companyId}`,
      )
    ).status(),
  ).toBe(403);
  await context.close();
  const denied = await browser.newContext({
      storageState: `${dir}/auth-page-only.json`,
      viewport: { width: 1440, height: 1000 },
    }),
    deniedPage = await denied.newPage();
  observe(deniedPage, 'page-only');
  await deniedPage.goto(
    `${f.base}functions/procurement/requests?subjectId=${f.companyId}`,
  );
  await expect(
    deniedPage.getByText('无权办理，请联系管理员。', { exact: true }),
  ).toBeVisible();
  await expect(
    deniedPage.getByRole('button', { name: '新建采购申请', exact: true }),
  ).toHaveCount(0);
  await take(deniedPage, 'permission-denied');
  expect(
    (
      await denied.request.get(
        `${f.base}api/procurement/requestMaterialOptions?subjectId=${f.companyId}`,
      )
    ).status(),
  ).toBe(403);
  await denied.close();
  expect(errors).toEqual([]);
});
test('checks empty, pagination, sorting, IME, themes, narrow screens and English', async ({
  browser,
}) => {
  const f = await fixture(),
    context = await browser.newContext({
      storageState: `${dir}/auth-admin.json`,
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage(),
    root = `${f.base}functions/procurement/requests`,
    errors: string[] = [];
  observe(page, 'visual');
  page.on('pageerror', (e) => errors.push(e.message));
  let releaseList!: () => void;
  const waitingForList = new Promise<void>((resolve) => {
    releaseList = resolve;
  });
  await page.route('**/api/procurement/requests?*', async (route) => {
    await waitingForList;
    await route.continue();
  });
  await page.goto(`${root}?subjectId=${f.emptyCompanyId}`);
  await expect(page.getByRole('radio', { name: /UI-EMPTY/ })).toBeVisible();
  await expect(page.getByLabel('加载中', { exact: true })).toBeVisible();
  await take(page, 'list-loading');
  releaseList();
  await expect(page.getByText('暂无采购申请', { exact: true })).toBeVisible();
  await page.unroute('**/api/procurement/requests?*');
  await expect(
    page.getByRole('button', { name: '新建采购申请', exact: true }),
  ).toHaveCount(1);
  await take(page, 'list-empty');
  await page.goto(`${root}?subjectId=${f.companyId}`);
  await expect(page.getByRole('table')).toBeVisible();
  const shortCell = page
    .getByRole('cell', { name: '设备保障部', exact: true })
    .first()
    .locator('span');
  await expect(shortCell).toBeVisible();
  await shortCell.hover();
  await expect(shortCell).not.toHaveAttribute('title');
  await page
    .getByRole('button', { name: '下一页', exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/page=2/);
  await page
    .getByRole('button', { name: '需求日期 · 升序', exact: true })
    .click();
  await expect(page).toHaveURL(/orderBy=neededOn/);
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  await take(page, 'list-paginated');
  const search = page.getByRole('textbox', {
    name: '搜索单号、用途或备注',
    exact: true,
  });
  await search.pressSequentially('abc');
  await search.press('Home');
  await search.pressSequentially('Z');
  await expect(search).toHaveValue('Zabc');
  expect(
    await search.evaluate((input: HTMLInputElement) => input.selectionStart),
  ).toBe(1);
  await expect(page).toHaveURL(/q=Zabc/);
  await search.fill('');
  await expect(page).not.toHaveURL(/q=/);
  await search.focus();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', {
    text: 'caigou',
    selectionStart: 6,
    selectionEnd: 6,
  });
  await page.waitForTimeout(350);
  expect(new URL(page.url()).searchParams.get('q')).not.toBe('caigou');
  await cdp.send('Input.insertText', { text: '采购' });
  await expect(search).toHaveValue('采购');
  await expect
    .poll(() => new URL(page.url()).searchParams.get('q'))
    .toBe('采购');
  await cdp.detach();
  await search.fill('');
  await expect(page).not.toHaveURL(/q=/);
  await expect(page.getByRole('table').getByRole('link').first()).toBeVisible();
  for (const preset of ['compact', 'default'])
    for (const dark of [false, true]) {
      await page.evaluate(
        ({ preset, dark }) => {
          document.documentElement.dataset.theme = preset;
          document.documentElement.classList.toggle('dark', dark);
          localStorage.setItem('nocobase:main:theme:preset', preset);
          localStorage.setItem(
            'nocobase:main:theme:color-scheme',
            dark ? 'dark' : 'light',
          );
        },
        { preset, dark },
      );
      await page.setViewportSize({ width: dark ? 375 : 1440, height: 1000 });
      await take(page, `list-${preset}-${dark ? 'dark-mobile' : 'light'}`);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
    }
  await page.goto(`${root}/new?subjectId=${f.companyId}`);
  await expect(
    liveForm(page).getByRole('radio', { name: /采购申请人（验收）/ }),
  ).toBeVisible();
  await expect(
    liveForm(page).getByRole('radio', { name: /设备采购供应商/ }),
  ).toBeVisible();
  await take(page, 'request-form-mobile-dark');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    liveForm(page).getByRole('radio', { name: /设备采购供应商/ }),
  ).toBeVisible();
  await take(page, 'request-form');
  await page.setViewportSize({ width: 375, height: 1000 });
  const purpose = liveForm(page).getByRole('textbox', { name: /用途/ });
  await purpose.pressSequentially('abc');
  await purpose.press('Home');
  await purpose.pressSequentially('Z');
  await expect(purpose).toHaveValue('Zabc');
  expect(
    await purpose.evaluate(
      (input: HTMLTextAreaElement) => input.selectionStart,
    ),
  ).toBe(1);
  await purpose.fill('');
  await purpose.focus();
  const formCdp = await context.newCDPSession(page);
  await formCdp.send('Input.imeSetComposition', {
    text: 'yongtu',
    selectionStart: 6,
    selectionEnd: 6,
  });
  await formCdp.send('Input.insertText', { text: '用途测试' });
  await expect(purpose).toHaveValue('用途测试');
  await formCdp.detach();
  await liveForm(page)
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '放弃修改', exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${root}?subjectId=${f.companyId}`);
  await page.getByRole('button', { name: '打开账户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: /语言/ }).hover();
  await page
    .getByRole('menuitemradio', { name: 'English', exact: true })
    .click();
  await page.goto(`${root}?subjectId=${f.companyId}`);
  await expect(
    page.getByRole('heading', { name: 'Purchase requests', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('radio', { name: /UI-PURCHASE/ })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('link', { name: /^PR-/ }).first()).toBeVisible();
  await take(page, 'list-en');
  await page.goto(`${root}/new?subjectId=${f.companyId}`);
  await expect(
    liveForm(page).getByRole('button', { name: 'Save draft', exact: true }),
  ).toBeVisible();
  await expect(
    liveForm(page).getByRole('radio', { name: /设备采购供应商/ }),
  ).toBeVisible();
  await expect(
    liveForm(page).getByRole('radio', { name: /采购申请人（验收）/ }),
  ).toBeVisible();
  await take(page, 'request-form-en');
  await context.request.put(`${f.base}api/i18n/locale`, {
    headers: { Origin: new URL(f.base).origin },
    data: { locale: 'zh-CN' },
  });
  expect(errors).toEqual([]);
  await writeFile(
    `${shots}/visual-log.json`,
    JSON.stringify(
      {
        errors,
        checks: [
          'empty',
          'server pagination',
          'server sort',
          'middle caret',
          'Chinese IME',
          'two presets light/dark at 375px',
          'English',
        ],
      },
      null,
      2,
    ),
  );
  await context.close();
});
test('returns, withdraws, revises, cancels and copies through reason forms and object confirmations', async ({
  page,
  browser,
  context,
}) => {
  const f = await fixture(),
    root = `${f.base}functions/procurement/requests`,
    review = await browser.newContext({
      storageState: `${dir}/auth-reviewer.json`,
      viewport: { width: 1440, height: 1000 },
    }),
    reviewPage = await review.newPage();
  observe(reviewPage, 'reviewer-actions');
  const source = (
    await (
      await context.request.get(
        `${f.base}api/procurement/requests/${f.cancelledId}`,
      )
    ).json()
  ).data;
  const prepared = {
    subjectId: source.subjectId,
    requesterEmployeeId: source.requesterEmployeeId,
    requestingUnitId: source.requestingUnitId,
    usage: 'Browser action recovery',
    neededOn: source.neededOn,
    suggestedSupplierId: source.suggestedSupplierId,
    projectId: null,
    notes: source.notes,
    lines: source.lines
      .filter((l: { status: string }) => l.status === 'active')
      .map((l: { selectionInput: { id: string } }) => ({
        ...l.selectionInput,
        id: crypto.randomUUID(),
      })),
  };
  const draftSeed = (
    await (
      await context.request.post(`${f.base}api/procurement/requests`, {
        headers: { Origin: new URL(f.base).origin },
        data: { content: prepared, requestKey: crypto.randomUUID() },
      })
    ).json()
  ).data;
  const pending = (
    await (
      await context.request.post(
        `${f.base}api/procurement/requests/${draftSeed.id}/submit`,
        {
          headers: { Origin: new URL(f.base).origin },
          data: {
            version: draftSeed.revision,
            lifecycleVersion: draftSeed.lifecycleVersion,
            requestKey: crypto.randomUUID(),
            reason: 'Prepare a fresh review round',
          },
        },
      )
    ).json()
  ).data;
  const pendingId = pending.id as string;
  await reviewPage.goto(`${root}/${pendingId}?subjectId=${f.companyId}`);
  await action(reviewPage, '退回', 'Revise demand before approval', true);
  await page.goto(`${root}/${pendingId}?subjectId=${f.companyId}`);
  await action(page, '提交', 'Resubmit under the frozen rules');
  await action(page, '撤回', 'Applicant withdraws the pending round', true);
  await action(page, '提交', 'Submit a new review round');
  await reviewPage.goto(`${root}/${pendingId}?subjectId=${f.companyId}`);
  await action(reviewPage, '批准', 'Approve the frozen demand');
  await page.goto(`${root}/${pendingId}?subjectId=${f.companyId}`);
  await action(page, '修订', 'Reopen approved content for correction', true);
  await action(page, '取消', 'Cancel revised demand', true);
  await page.getByRole('button', { name: '复制为新申请', exact: true }).click();
  const form = liveForm(page);
  await form
    .getByRole('textbox', { name: /复制原因/ })
    .fill('Replacement demand after cancellation');
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/${pendingId}/copy`) && r.request().method() === 'POST',
  );
  await form.getByRole('button', { name: '保存', exact: true }).click();
  const next = (await (await created).json()).data;
  expect(next.status).toBe('draft');
  expect(next.supersedesId).toBe(pendingId);
  expect(next.recentHistory[0].reason).toBe(
    'Replacement demand after cancellation',
  );
  await expect(
    page
      .locator('[data-slot=route-child-page]')
      .last()
      .getByRole('link', { name: next.code, exact: true }),
  ).toBeVisible();
  await page
    .locator('[data-slot=route-child-page]')
    .last()
    .getByRole('link', { name: next.code, exact: true })
    .click();
  await expect(
    page.getByText('此处只读查看；如需办理，请返回申请列表并搜索此单号。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .locator('[data-slot=route-child-page]')
      .last()
      .getByRole('button', { name: '提交', exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator('[data-slot=route-child-page]')
      .last()
      .getByText('Replacement demand after cancellation', { exact: true }),
  ).toBeVisible();
  await take(page, 'copied-related');
  await page
    .locator('[data-slot=route-child-page]')
    .last()
    .getByRole('link', { name: '返回', exact: true })
    .click();
  await expect(page).toHaveURL(`${root}/${pendingId}?subjectId=${f.companyId}`);
  await review.close();
});

test('recovers from 401, 403, 404, 500 and network failures without exposing stale readable rows', async ({
  browser,
}) => {
  const f = await fixture();
  for (const status of [401, 403, 404, 500, 0]) {
    const context = await browser.newContext({
        storageState: `${dir}/auth-applicant.json`,
        viewport: { width: 1440, height: 1000 },
      }),
      page = await context.newPage(),
      root = `${f.base}functions/procurement/requests`;
    observe(page, `error-${status}`);
    await page.goto(`${root}?subjectId=${f.companyId}`);
    await expect(page.getByRole('table')).toBeVisible();
    await page.route('**/api/procurement/requests?*', (route) =>
      status === 0
        ? route.abort('failed')
        : route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                status:
                  status === 401
                    ? 'UNAUTHENTICATED'
                    : status === 403
                      ? 'PERMISSION_DENIED'
                      : status === 404
                        ? 'NOT_FOUND'
                        : 'INTERNAL',
                reason: 'ISOLATED_FAILURE',
                message: 'never display raw payload',
              },
            }),
          }),
    );
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    if ([401, 403, 404].includes(status)) {
      await expect(page.getByRole('table')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: '重试', exact: true }),
      ).toHaveCount(0);
      if (status === 401) {
        await expect(
          page.getByRole('button', { name: '重新登录', exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText('登录会话已结束，请重新登录。', { exact: true }),
        ).toBeVisible();
      }
    } else {
      await expect(page.getByRole('table')).toBeVisible();
      await expect(
        page.getByRole('button', { name: '重试', exact: true }),
      ).toBeVisible();
    }
    await expect(
      page.getByText('never display raw payload', { exact: true }),
    ).toHaveCount(0);
    await take(page, `error-${status || 'network'}`);
    await context.close();
  }
});

test('opens edit from both a filtered row menu and record details with the correct parent layer', async ({
  page,
  context,
}) => {
  const f = await fixture(),
    row = (
      await (
        await context.request.get(
          `${f.base}api/procurement/requests/${f.mixedId}`,
        )
      ).json()
    ).data,
    root = `${f.base}functions/procurement/requests`,
    url = `${root}?subjectId=${f.companyId}&q=${row.code}`;
  await page.goto(url);
  await page
    .getByRole('button', { name: `采购申请“${row.code}”的操作`, exact: true })
    .click();
  await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
  await expect(page).toHaveURL(
    `${root}/edit/${row.id}?subjectId=${f.companyId}&q=${row.code}`,
  );
  await expect(page.locator('[data-slot=route-child-page]')).toHaveCount(1);
  await liveForm(page)
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await expect(page).toHaveURL(url);
  await expect(
    page.getByRole('textbox', { name: '搜索单号、用途或备注', exact: true }),
  ).toBeFocused();
  await page.getByRole('link', { name: row.code, exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.locator('[data-slot=route-child-page]')).toHaveCount(2);
  await liveForm(page)
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await expect(page).toHaveURL(
    `${root}/${row.id}?subjectId=${f.companyId}&q=${row.code}`,
  );
  await expect(page.locator('[data-slot=route-child-page]')).toHaveCount(1);
  await expect(
    page
      .locator('[data-slot=route-child-page]')
      .last()
      .locator('[id^=purchase-detail-title-]'),
  ).toBeFocused();
  await page.getByRole('link', { name: '返回', exact: true }).last().click();
  await expect(page).toHaveURL(url);
  await expect(
    page.getByRole('textbox', { name: '搜索单号、用途或备注', exact: true }),
  ).toBeFocused();
});

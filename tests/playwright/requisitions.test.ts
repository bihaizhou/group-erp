/// <reference lib="dom" />
import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const dir = 'storage/ui-workflow/requisitions',
  shots = `${dir}/screenshots`;
interface Fixture {
  base: string;
  companyId: string;
  emptyCompanyId: string;
  purposeId: string;
  draftId: string;
  draftCode: string;
  mixedId: string;
  pendingId: string;
  pendingCode: string;
}
const fixture = async () =>
  JSON.parse(await readFile(`${dir}/fixture.json`, 'utf8')) as Fixture;
test.use({
  storageState: `${dir}/auth-applicant.json`,
  viewport: { width: 1440, height: 1000 },
  actionTimeout: 15000,
});
const captures: { test: string; errors: string[]; status?: string }[] = [];
let errors: string[] = [];
const intentionalStatuses = new Set<number>();
function observe(page: Page) {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (
      msg.type() === 'error' &&
      ![...intentionalStatuses].some((code) =>
        msg.text().includes(`status of ${code}`),
      )
    )
      errors.push(msg.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !intentionalStatuses.has(r.status()))
      errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
}
test.beforeEach(async ({ page }) => {
  errors = [];
  intentionalStatuses.clear();
  observe(page);
  await mkdir(shots, { recursive: true });
});

test('shows a useful empty state, editable review settings and a recoverable server failure', async ({
  browser,
}) => {
  const f = await fixture(),
    context = await browser.newContext({
      storageState: `${dir}/auth-admin.json`,
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  observe(page);
  const emptyUrl = `${f.base}functions/requisitions/requests?subjectId=${f.emptyCompanyId}`;
  await page.goto(emptyUrl);
  await expect(page.getByText('暂无领用申请', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '新建领用申请', exact: true }),
  ).toHaveCount(1);
  await take(page, 'requests-empty');
  intentionalStatuses.add(500);
  await page.route(
    (url) => url.pathname.endsWith('/api/requisitions/requests'),
    (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 500,
            status: 'INTERNAL',
            reason: 'INTERNAL_ERROR',
            domain: 'isolated-test',
            message: 'Isolated failure',
          },
        }),
      }),
    { times: 1 },
  );
  await page.reload();
  await expect(
    page.getByRole('button', { name: '重试', exact: true }),
  ).toBeVisible();
  await take(page, 'requests-server-failure');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('暂无领用申请', { exact: true })).toBeVisible();
  await context.close();
  const agent = await browser.newContext({
      storageState: `${dir}/auth-agent.json`,
      viewport: { width: 1440, height: 1000 },
    }),
    settings = await agent.newPage();
  observe(settings);
  await settings.goto(
    `${f.base}functions/requisitions/settings?subjectId=${f.companyId}`,
  );
  await expect(
    settings.getByRole('heading', { name: '领用规则', exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByRole('button', { name: '保存', exact: true }),
  ).toBeEnabled();
  await settings.getByRole('button', { name: '保存', exact: true }).click();
  await expect(
    settings.getByText('已保存本公司审核规则', { exact: true }),
  ).toBeVisible();
  await take(settings, 'review-settings');
  await agent.close();
});

test('preserves the edited request and explains a permission failure without repeating the write', async ({
  page,
}) => {
  const f = await fixture();
  await page.goto(
    `${f.base}functions/requisitions/requests/${f.draftId}/edit?subjectId=${f.companyId}`,
  );
  const form = page.locator('#issue-request-form');
  await expect(form).toBeVisible({ timeout: 15000 });
  await form
    .locator('#issue-notes')
    .fill('保留这份未保存的输入，等待职责恢复后核对。');
  await form.locator('#issue-reason').pressSequentially('补充现场说明');
  intentionalStatuses.add(403);
  let writes = 0;
  await page.route(
    (url) => url.pathname.endsWith(`/api/requisitions/requests/${f.draftId}`),
    async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      writes += 1;
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 403,
            status: 'PERMISSION_DENIED',
            reason: 'ISSUE_FORBIDDEN',
            domain: 'requisitions',
            message: 'Isolated permission change',
          },
        }),
      });
    },
  );
  await form.getByRole('button', { name: '保存', exact: true }).click();
  await expect(form.locator('#issue-notes')).toHaveValue(
    '保留这份未保存的输入，等待职责恢复后核对。',
  );
  await expect(
    form.getByRole('button', { name: '保存', exact: true }),
  ).toBeDisabled();
  expect(writes).toBe(1);
  await take(page, 'permission-denied-edit');
});
test('reviews a real issue conflict and explicitly merges local usage with remote notes', async ({
  page,
}) => {
  const f = await fixture(),
    baseEndpoint = `${f.base}api/requisitions/requests`,
    template = (
      await (await page.request.get(`${baseEndpoint}/${f.mixedId}`)).json()
    ).data,
    content = {
      subjectId: template.subjectId,
      requesterEmployeeId: template.requesterEmployeeId,
      recipientEmployeeId: template.recipientEmployeeId,
      requestingUnitId: template.requestingUnitId,
      purposeId: template.purposeId,
      usage: 'Original issue usage',
      neededOn: template.neededOn,
      projectId: null,
      notes: '',
      attachments: [],
      lines: template.lines
        .filter((line: { status: string }) => line.status === 'active')
        .map((line: { selectionInput: object }) => ({
          ...line.selectionInput,
          id: randomUUID(),
        })),
    },
    headers = { Origin: new URL(f.base).origin },
    created = await page.request.post(baseEndpoint, {
      headers,
      data: { requestKey: randomUUID(), content },
    });
  expect(created.status()).toBe(201);
  const row = (await created.json()).data,
    endpoint = `${baseEndpoint}/${row.id}`,
    detail = `${f.base}functions/requisitions/requests/${row.id}?subjectId=${f.companyId}&q=conflict`;
  await page.goto(
    `${f.base}functions/requisitions/requests/${row.id}/edit?subjectId=${f.companyId}&q=conflict`,
  );
  const form = page.locator('#issue-request-form');
  await expect(form).toBeVisible({ timeout: 15000 });
  await form.locator('#issue-usage').fill('Local issue usage retained');
  await form.locator('#issue-reason').fill('核对本地用途与另一位经办人的备注');
  const changed = await page.request.patch(endpoint, {
    headers,
    data: {
      content: {
        ...content,
        lines: row.lines.map(
          (line: { selectionInput: object }) => line.selectionInput,
        ),
        usage: 'Remote issue usage',
        notes: 'Remote issue notes retained',
      },
      version: row.revision,
      lifecycleVersion: row.lifecycleVersion,
      requestKey: randomUUID(),
      reason: 'Isolated concurrent editor',
    },
  });
  expect(changed.status()).toBe(200);
  intentionalStatuses.add(409);
  await form.getByRole('button', { name: '保存', exact: true }).click();
  await expect(
    form.getByText('资料已更新，请核对后再保存。', { exact: true }),
  ).toBeVisible();
  await form.getByRole('button', { name: '核对最新版本', exact: true }).click();
  await form
    .getByRole('radio', { name: /保留本地值: Local issue usage retained/ })
    .click();
  await take(page, 'issue-conflict-explicit-merge');
  await form
    .getByRole('button', { name: '应用已核对合并', exact: true })
    .click();
  await expect(form.locator('#issue-notes')).toHaveValue(
    'Remote issue notes retained',
  );
  await expect(form.locator('#issue-usage')).toHaveValue(
    'Local issue usage retained',
  );
  await form.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page).toHaveURL(detail);
  const saved = (await (await page.request.get(endpoint)).json()).data;
  expect(saved).toMatchObject({
    usage: 'Local issue usage retained',
    notes: 'Remote issue notes retained',
    status: 'draft',
  });
});
test.afterEach(async ({ page: _page }, info) => {
  const previous = JSON.parse(
    await readFile(`${dir}/browser-results.json`, 'utf8').catch(() => '[]'),
  ) as { test: string; errors: string[]; status?: string }[];
  previous.push({ test: info.title, status: info.status, errors: [...errors] });
  captures.push({ test: info.title, errors: [...errors] });
  await writeFile(
    `${dir}/browser-results.json`,
    JSON.stringify(previous, null, 2),
  );
  expect(errors).toEqual([]);
});
const take = async (page: Page, name: string) => {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    );
  });
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
const active = (page: Page) =>
  page.locator('[data-slot=route-child-page]').last();
async function requestAction(page: Page, label: string, reason: string) {
  await active(page).getByRole('button', { name: label, exact: true }).click();
  const dialog = page.locator('[data-slot=route-overlay-content]');
  await dialog.locator('#issue-action-reason').pressSequentially(reason);
  await dialog.getByRole('button', { name: label, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
test('creates a mixed issue request with recipient, exact packaging and recoverable nested selection', async ({
  page,
}) => {
  const f = await fixture(),
    root = `${f.base}functions/requisitions/requests`;
  await page.goto(f.base);
  await expect(
    page.getByRole('heading', { name: '集团 ERP', exact: true }),
  ).toBeVisible();
  await take(page, 'baseline-home');
  await page.goto(`${root}?subjectId=${f.companyId}`);
  await expect(
    page.getByRole('heading', { name: '领用申请', exact: true }),
  ).toBeVisible();
  await take(page, 'request-list');
  await page.getByRole('button', { name: '新建领用申请', exact: true }).click();
  const form = page.locator('#issue-request-form');
  await expect(form).toBeVisible();
  for (const id of ['requesterEmployeeId', 'recipientEmployeeId']) {
    await form.locator(`#issue-${id}`).click();
    await page
      .getByRole('radiogroup', {
        name: `${id === 'requesterEmployeeId' ? '申请人' : '领用人'} (提交必填)`,
        exact: true,
      })
      .getByRole('radio', { name: /申请人甲/u })
      .click();
  }
  await form.locator('#issue-requestingUnitId').click();
  await page.getByRole('radio', { name: /设备保障部/u }).click();
  await form.locator('#issue-purposeId').click();
  await page.getByRole('radio', { name: /设备维修/u }).click();
  await form.locator('#issue-usage').pressSequentially('设备检修现场领用');
  await form.getByRole('button', { name: '需求日期', exact: true }).click();
  const day = await page.evaluate(() => new Date().toLocaleDateString('zh-CN'));
  await page.locator(`button[data-day="${day}"]`).first().click();
  await active(page)
    .locator(':scope > div')
    .evaluate((el) => {
      el.scrollTop = 0;
    });
  await take(page, 'form-header');
  await form.getByRole('button', { name: '添加明细', exact: true }).click();
  const one = form.getByRole('group', { name: '明细1', exact: true });
  await one.getByRole('radio', { name: '已有物料', exact: true }).click();
  await one.getByRole('button', { name: '选择物料', exact: true }).click();
  const picker = page.locator('[data-slot=route-overlay-content]');
  await picker.getByRole('radio', { name: /耐磨手套/u }).click();
  await picker.getByRole('combobox', { name: '具体包装', exact: true }).click();
  await page.getByRole('option', { name: /每箱12件/u }).click();
  await picker.getByRole('textbox', { name: /需求数量/u }).fill('2');
  await expect(picker.getByText(/基准需求量: 24/u)).toBeVisible();
  await take(page, 'material-selection');
  await picker.getByRole('button', { name: '使用', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await form.getByRole('button', { name: '添加明细', exact: true }).click();
  const two = form.getByRole('group', { name: '明细2', exact: true });
  await two
    .getByRole('textbox', { name: '原始名称 *', exact: true })
    .pressSequentially('现场旧阀门');
  await two
    .getByRole('textbox', { name: '原始规格 *', exact: true })
    .fill('耐高温，具体型号待确认');
  await two
    .getByRole('textbox', { name: '单位文字 *', exact: true })
    .fill('套');
  await two
    .getByRole('textbox', { name: '需求数量 *', exact: true })
    .fill('3.125');
  await take(page, 'mixed-form');
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/requisitions/requests') &&
      r.request().method() === 'POST',
  );
  await form.getByRole('button', { name: '保存草稿', exact: true }).click();
  const saved = (await (await response).json()).data;
  expect(saved.lines[0].baseQuantity).toBe('24');
  expect(saved.lines[1].requestedQuantity).toBe('3.125');
  expect(saved.recipientEmployeeId).toBeTruthy();
  await expect(page).toHaveURL(`${root}?subjectId=${f.companyId}`);
  await page.getByRole('link', { name: saved.code, exact: true }).click();
  await requestAction(page, '提交', '混合领用需求，独立审核');
  await expect(
    active(page).getByText('待审核', { exact: true }).first(),
  ).toBeVisible();
  await take(page, 'pending-detail');
});
test('an independent ordinary reviewer approves a request and cannot edit the applicant content', async ({
  page,
  browser,
}) => {
  const f = await fixture();
  const reviewer = await browser.newContext({
      storageState: `${dir}/auth-reviewer.json`,
      viewport: { width: 1440, height: 1000 },
    }),
    reviewPage = await reviewer.newPage();
  observe(reviewPage);
  await reviewPage.goto(
    `${f.base}functions/requisitions/requests/${f.pendingId}?subjectId=${f.companyId}`,
  );
  await expect(
    active(reviewPage).getByRole('button', { name: '批准', exact: true }),
  ).toBeEnabled();
  await expect(
    active(reviewPage).getByRole('button', { name: '编辑', exact: true }),
  ).toHaveCount(0);
  await requestAction(reviewPage, '批准', '审核用途与领用人，批准当前快照');
  await expect(
    active(reviewPage).getByText('已批准', { exact: true }).first(),
  ).toBeVisible();
  await take(reviewPage, 'approved-reviewer');
  await reviewer.close();
  await page.goto(
    `${f.base}functions/requisitions/requests/${f.pendingId}?subjectId=${f.companyId}`,
  );
  await expect(
    active(page).getByText('已批准', { exact: true }).first(),
  ).toBeVisible();
});
test('purpose maintenance uses nested drawer forms and a named reason confirmation', async ({
  browser,
}) => {
  const f = await fixture(),
    context = await browser.newContext({
      storageState: `${dir}/auth-agent.json`,
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  observe(page);
  await page.goto(
    `${f.base}functions/requisitions/purposes?subjectId=${f.companyId}`,
  );
  await page.getByRole('link', { name: 'REPAIR', exact: true }).click();
  const drawer = page.locator('[data-slot=route-overlay-content]');
  await expect(
    drawer.getByText('设备维修', { exact: true }).first(),
  ).toBeVisible();
  await expect(drawer).toHaveCSS('opacity', '1');
  await take(page, 'purpose-detail');
  await drawer.getByRole('button', { name: '编辑', exact: true }).click();
  const edit = page.locator('[data-slot=route-overlay-content]').last();
  await edit
    .locator('#purpose-description')
    .pressSequentially('仅按核准需求办理。');
  await edit.locator('#purpose-reason').pressSequentially('完善用途说明');
  await edit.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('[data-slot=route-overlay-content]')).toHaveCount(
    1,
  );
  await expect(drawer.getByText(/仅按核准需求办理/u)).toBeVisible();
  await drawer.getByRole('button', { name: '停用', exact: true }).click();
  const action = page.locator('[data-slot=route-overlay-content]').last();
  await action.locator('#purpose-reason').pressSequentially('暂停新增此类需求');
  await action.getByRole('button', { name: '停用', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText(/设备维修/u).first()).toBeVisible();
  await confirm.getByRole('button', { name: '停用', exact: true }).click();
  await expect(page.locator('[data-slot=route-overlay-content]')).toHaveCount(
    1,
  );
  await expect(drawer.getByText('停用', { exact: true }).first()).toBeVisible();
  await take(page, 'purpose-inactive');
  await context.close();
});
test('preserves Chinese search and filtered return, and renders both presets in light and narrow dark mode', async ({
  page,
}) => {
  const f = await fixture();
  await page.goto(
    `${f.base}functions/requisitions/requests?subjectId=${f.companyId}`,
  );
  const search = page.locator('#issue-search');
  await search.pressSequentially('设备');
  const cdp = await page.context().newCDPSession(page);
  await search.focus();
  await cdp.send('Input.imeSetComposition', {
    text: 'jianxiu',
    selectionStart: 7,
    selectionEnd: 7,
  });
  await cdp.send('Input.insertText', { text: '检修' });
  await cdp.detach();
  await expect(search).toHaveValue('设备检修');
  await expect(page).toHaveURL(/q=/u);
  await page.getByRole('link', { name: f.draftCode, exact: true }).click();
  await page.reload();
  await expect(
    active(page).getByText(f.draftCode, { exact: false }).first(),
  ).toBeVisible();
  await active(page).getByRole('link', { name: /返回/u }).first().click();
  await expect(search).toHaveValue('设备检修');
  for (const preset of ['default', 'compact'])
    for (const dark of [false, true]) {
      await page.evaluate(
        ({ preset, dark }) => {
          document.documentElement.dataset.theme = preset;
          document.documentElement.classList.remove('light', 'dark');
          document.documentElement.classList.add(dark ? 'dark' : 'light');
          document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
          localStorage.setItem('nocobase:main:theme:preset', preset);
          localStorage.setItem(
            'nocobase:main:theme:color-scheme',
            dark ? 'dark' : 'light',
          );
        },
        { preset, dark },
      );
      await page.setViewportSize(
        dark ? { width: 375, height: 812 } : { width: 1440, height: 1000 },
      );
      await page.reload();
      await expect(
        page.getByRole('heading', { name: '领用申请', exact: true }),
      ).toBeVisible();
      await expect(page.locator('body')).toHaveCSS(
        'color',
        dark ? 'oklch(0.96 0 0)' : 'oklch(0.16 0 0)',
      );
      await expect(
        page.getByRole('link', { name: f.draftCode, exact: true }),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.locator('input').first().blur();
      await take(page, `list-${preset}-${dark ? 'dark-mobile' : 'light'}`);
    }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'default';
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
    document.documentElement.style.colorScheme = 'light';
  });
  await page.getByRole('button', { name: '打开账户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: /语言/u }).hover();
  await page
    .getByRole('menuitemradio', { name: 'English', exact: true })
    .click();
  await page.goto(
    `${f.base}functions/requisitions/requests?subjectId=${f.companyId}`,
  );
  await expect(
    page.getByRole('heading', { name: 'Issue requests', exact: true }),
  ).toBeVisible();
  await take(page, 'list-en');
  await page.goto(
    `${f.base}functions/requisitions/requests/new?subjectId=${f.companyId}`,
  );
  await expect(page.locator('#issue-recipientEmployeeId')).toBeVisible();
  await expect(
    page
      .locator('#issue-request-form')
      .getByRole('button', { name: 'Save draft', exact: true }),
  ).toBeVisible();
  await take(page, 'form-en');
  await page.context().request.put(`${f.base}api/i18n/locale`, {
    headers: { Origin: new URL(f.base).origin },
    data: { locale: 'zh-CN' },
  });
});

test('refreshes a missing request out of the parent list and keeps rule removal focus', async ({
  page,
  browser,
}) => {
  const f = await fixture();
  let listReads = 0;
  await page.route(/\/api\/requisitions\/requests\?/u, async (route) => {
    listReads++;
    if (listReads === 1) {
      await route.continue();
      return;
    }
    const response = await route.fetch(),
      body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, data: [], meta: { ...body.meta, total: 0 } },
    });
  });
  await page.goto(
    `${f.base}functions/requisitions/requests?subjectId=${f.companyId}`,
  );
  const link = page.getByRole('link', { name: f.draftCode, exact: true });
  await expect(link).toBeVisible();
  intentionalStatuses.add(404);
  await page.route(`**/api/requisitions/requests/${f.draftId}`, (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          status: 'NOT_FOUND',
          domain: 'requisitions',
          reason: 'ISSUE_NOT_FOUND',
          message: 'Missing isolated record',
        },
      }),
    }),
  );
  await link.click();
  await expect(
    active(page)
      .getByText(/不存在|不可用/u)
      .first(),
  ).toBeVisible();
  await active(page).getByRole('link', { name: /返回/u }).first().click();
  await expect.poll(() => listReads).toBeGreaterThan(1);
  await expect(link).toHaveCount(0);
  await take(page, 'missing-request-return');
  const context = await browser.newContext({
      storageState: `${dir}/auth-agent.json`,
    }),
    rules = await context.newPage();
  observe(rules);
  await rules.goto(
    `${f.base}functions/requisitions/settings?subjectId=${f.companyId}`,
  );
  await rules
    .getByRole('button', { name: '移除条件', exact: true })
    .first()
    .click();
  await expect(rules.locator('#issue-add-group')).toBeFocused();
  await take(rules, 'rule-removal-focus');
  await context.close();
});
test('locates unknown-line validation at each input on a narrow form', async ({
  page,
}) => {
  const f = await fixture();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(
    `${f.base}functions/requisitions/requests/new?subjectId=${f.companyId}`,
  );
  const form = page.locator('#issue-request-form');
  await expect(form).toBeVisible();
  await form.getByRole('button', { name: '添加明细', exact: true }).click();
  await form.getByRole('button', { name: '保存草稿', exact: true }).click();
  const name = form.getByLabel('原始名称 *', { exact: true });
  await expect(name).toBeFocused();
  await expect(
    form.locator('input[aria-invalid=true],textarea[aria-invalid=true]'),
  ).toHaveCount(4);
  await name.pressSequentially('现场检修');
  await expect(name).toHaveAttribute('aria-invalid', 'false');
  await take(page, 'narrow-line-validation');
});

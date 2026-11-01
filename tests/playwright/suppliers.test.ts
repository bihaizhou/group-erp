/// <reference lib="dom" />
import { test, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const directory = 'storage/ui-workflow/procurement-suppliers',
  shots = `${directory}/screenshots`;
type Fixture = {
  base: string;
  companyA: string;
  companyB: string;
  emptyCompany: string;
  pageCompany: string;
  regionId: string;
  partnerId: string;
  supplierName: string;
};
const fixture = async () =>
  JSON.parse(await readFile(`${directory}/fixture.json`, 'utf8')) as Fixture;
test.use({
  storageState: `${directory}/auth.json`,
  viewport: { width: 1440, height: 1000 },
  actionTimeout: 10000,
});
test('supplier UI persists identity, scope and independent global/company decisions on LAN HTTP', async ({
  page,
  context,
}) => {
  const f = await fixture(),
    root = `${f.base}functions/procurement/suppliers`,
    errors: string[] = [];
  await mkdir(shots, { recursive: true });
  page.on('pageerror', (e) => errors.push(e.message));
  await context.addInitScript(() =>
    Object.defineProperty(Crypto.prototype, 'randomUUID', {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto(f.base);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.waitForTimeout(300);
  const baseline = errors.splice(0);
  await page.screenshot({ path: `${shots}/baseline.png` });
  await page.goto(`${root}?subjectId=${f.emptyCompany}`);
  await expect(page.getByText('暂无供应商', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '新建供应商', exact: true }),
  ).toHaveCount(1);
  await page.screenshot({ path: `${shots}/empty.png` });
  await page.getByRole('button', { name: '新建供应商', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: /^编码/ })).toBeVisible();
  await dialog
    .getByRole('textbox', { name: /^编码/ })
    .pressSequentially('UI-CREATED');
  await dialog
    .getByRole('textbox', { name: /^名称/ })
    .pressSequentially('Browser supplier');
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page).toHaveURL(`${root}?subjectId=${f.emptyCompany}`);
  await expect(
    page.getByRole('link', { name: 'Browser supplier', exact: true }),
  ).toBeVisible();
  const detail = `${root}/${f.partnerId}?subjectId=${f.companyB}`;
  await page.goto(detail);
  await expect(
    page.getByText('继承适用规则，尚无公司覆盖记录', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '仅本公司停用', exact: true }).click();
  let alert = page.getByRole('alertdialog');
  await expect(alert).toContainText('项目公司乙');
  await alert
    .getByRole('textbox', { name: /修改原因/ })
    .pressSequentially('Disable B only');
  await alert
    .getByRole('button', { name: /^(停用|恢复)$/, exact: true })
    .click();
  await expect(page).toHaveURL(detail);
  await page.goto(`${root}/${f.partnerId}?subjectId=${f.companyA}`);
  await page.getByRole('button', { name: '全部公司停用', exact: true }).click();
  alert = page.getByRole('alertdialog');
  await expect(alert).toContainText('全部适用公司');
  await alert.getByRole('textbox', { name: /修改原因/ }).fill('Global disable');
  await page.screenshot({ path: `${shots}/global-confirm.png` });
  await alert
    .getByRole('button', { name: /^(停用|恢复)$/, exact: true })
    .click();
  await page.getByRole('button', { name: '全局恢复', exact: true }).click();
  alert = page.getByRole('alertdialog');
  await alert.getByRole('textbox', { name: /修改原因/ }).fill('Global restore');
  await alert
    .getByRole('button', { name: /^(停用|恢复)$/, exact: true })
    .click();
  const b = await context.request.get(
    `${f.base}api/procurement/supplierAvailability/${f.partnerId}?subjectId=${f.companyB}`,
  );
  expect((await b.json()).data).toMatchObject({
    companyStatus: 'inactive',
    supplierStatus: 'active',
    effectiveStatus: 'inactive',
  });
  await page.goto(detail);
  await page
    .getByRole('button', { name: '恢复本公司使用', exact: true })
    .click();
  alert = page.getByRole('alertdialog');
  await alert
    .getByRole('textbox', { name: /修改原因/ })
    .fill('Restore B explicitly');
  await alert
    .getByRole('button', { name: /^(停用|恢复)$/, exact: true })
    .click();
  await expect(page).toHaveURL(detail);
  await page
    .getByRole('button', { name: '编辑本公司备注', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('textbox', { name: /本公司备注/ }),
  ).toBeVisible();
  await dialog
    .getByRole('textbox', { name: /本公司备注/ })
    .fill('只属于乙公司的备注');
  await dialog
    .getByRole('textbox', { name: /修改原因/ })
    .fill('Company note change');
  const submissions: string[] = [];
  let failOnce = true;
  await page.route('**/api/procurement/supplierOverrides', async (route) => {
    if (route.request().method() === 'POST') {
      submissions.push(route.request().postDataJSON().requestKey);
      if (failOnce) {
        failOnce = false;
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              status: 'INTERNAL',
              reason: 'SIMULATED_TEST_FAILURE',
              message: 'fixture failure',
            },
          }),
        });
      }
    }
    return route.continue();
  });
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(
    dialog.getByText('请求未完成，已保留输入内容。', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: /本公司备注/ })).toHaveValue(
    '只属于乙公司的备注',
  );
  await page.screenshot({ path: `${shots}/failed-save.png` });
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page).toHaveURL(detail);
  expect(submissions[0]).toBe(submissions[1]);
  await page.unroute('**/api/procurement/supplierOverrides');
  await page.getByRole('button', { name: '编辑公共资料', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: /^编码/ })).toHaveValue(
    'UI-SUP-01',
  );
  await dialog
    .getByRole('textbox', { name: /^名称/ })
    .fill('华东设备供应商（浏览器修改验证）');
  await dialog
    .getByRole('textbox', { name: /修改原因/ })
    .fill('Shared name change');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page).toHaveURL(detail);
  await expect(
    page.getByRole('heading', {
      name: '华东设备供应商（浏览器修改验证）',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: '编辑适用范围', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('combobox', { name: '适用范围', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('combobox', { name: '适用范围', exact: true }).click();
  await page
    .getByRole('option', { name: '按区域／指定公司', exact: true })
    .click();
  await dialog.getByText('UI-EAST · 华东区域', { exact: true }).click();
  await dialog
    .getByText('UI-A · 项目公司甲（临时验收）', { exact: true })
    .click();
  await dialog
    .getByRole('textbox', { name: /修改原因/ })
    .fill('Region plus explicit company');
  await page.screenshot({ path: `${shots}/scope-selected.png` });
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page).toHaveURL(detail);
  const scope = await context.request.get(
    `${f.base}api/procurement/supplierIdentities/${f.partnerId}/applicability`,
  );
  expect((await scope.json()).data).toMatchObject({
    scopeMode: 'selected',
    regionIds: [f.regionId],
    subjectIds: [f.companyA],
  });
  await expect(
    page
      .locator('[data-slot=route-child-page]')
      .getByText('区域规则', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator('[data-slot=route-child-page]')
      .getByText('只属于乙公司的备注', { exact: true })
      .first(),
  ).toBeVisible();
  await page.screenshot({ path: `${shots}/detail.png` });
  await page.getByRole('link', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(`${root}?subjectId=${f.companyB}`);
  await expect(
    page.getByRole('textbox', { name: '编码、名称或登记标识', exact: true }),
  ).toBeFocused();
  await page
    .getByRole('button', { name: '公共资料与适用范围', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: '公共资料与适用范围', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '编辑适用范围', exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({ path: `${shots}/directory.png` });
  expect(errors).toEqual([]);
  await writeFile(
    `${shots}/core-log.json`,
    JSON.stringify(
      {
        baseline,
        errors,
        checks: [
          'create',
          'inherited detail no setting',
          'local disable',
          'global disable/restore preserves B exclusion',
          'local restore',
          'notes save network retry same key',
          'identity shared update',
          'region/company scope union',
          'focus restoration',
          'global directory',
        ],
      },
      null,
      2,
    ),
  );
});
test('supplier states, themes, Chinese IME, English copy and restricted access', async ({
  page,
  browser,
  context,
}) => {
  const f = await fixture(),
    root = `${f.base}functions/procurement/suppliers`,
    errors: string[] = [];
  await mkdir(shots, { recursive: true });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${root}?subjectId=${f.companyA}`);
  await expect(page.getByRole('table')).toBeVisible();
  const search = page.getByRole('textbox', {
    name: '编码、名称或登记标识',
    exact: true,
  });
  await search.focus();
  await page.keyboard.type('UI-SUP');
  await page.waitForTimeout(400);
  await expect(page).toHaveURL(/q=UI-SUP/);
  await search.press('Home');
  await page.keyboard.type('X');
  await expect(search).toHaveValue('XUI-SUP');
  await search.press('ControlOrMeta+A');
  await search.press('Backspace');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', {
    text: 'hua',
    selectionStart: 3,
    selectionEnd: 3,
  });
  await page.waitForTimeout(400);
  expect(new URL(page.url()).searchParams.get('q')).not.toBe('hua');
  await cdp.send('Input.insertText', { text: '华东' });
  await expect(search).toHaveValue('华东');
  await page.waitForTimeout(400);
  expect(new URL(page.url()).searchParams.get('q')).toBe('华东');
  await search.fill('不存在的搜索');
  await page.waitForTimeout(400);
  await expect(
    page.getByText('没有匹配的供应商', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${shots}/no-results.png` });
  await page.goto(`${root}?subjectId=${f.companyA}`);
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
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${shots}/list-${preset}-${dark ? 'dark-mobile' : 'light'}.png`,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
  await page.goto(`${root}/${f.partnerId}/scope?subjectId=${f.companyA}`);
  await expect(
    page.getByRole('dialog').getByRole('textbox', { name: /修改原因/ }),
  ).toBeVisible();
  await page.screenshot({ path: `${shots}/scope-mobile-dark.png` });
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }),
  ).toBeInViewport();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const status of [403, 404, 500]) {
    await page.route('**/api/procurement/supplierAvailability?*', (route) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            status:
              status === 403
                ? 'PERMISSION_DENIED'
                : status === 404
                  ? 'NOT_FOUND'
                  : 'INTERNAL',
            message: 'fixture failure',
          },
        }),
      }),
    );
    await page.goto(`${root}?subjectId=${f.companyA}`);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(
      page.getByRole('button', { name: '重试', exact: true }),
    ).toHaveCount(status === 500 ? 1 : 0);
    await page.screenshot({ path: `${shots}/error-${status}.png` });
    await page.unroute('**/api/procurement/supplierAvailability?*');
  }
  const reader = await browser.newContext({
    storageState: `${directory}/auth-reader.json`,
  });
  const view = await reader.newPage();
  await view.goto(`${root}?subjectId=${f.companyA}`);
  await expect(view.getByRole('table')).toBeVisible();
  await expect(
    view.getByRole('button', { name: '新建供应商', exact: true }),
  ).toHaveCount(0);
  await expect(
    view.getByRole('button', { name: '公共资料与适用范围', exact: true }),
  ).toHaveCount(0);
  await view.screenshot({ path: `${shots}/reader.png` });
  expect(
    (
      await reader.request.get(
        `${f.base}api/procurement/supplierCompanies/${f.companyB}`,
      )
    ).status(),
  ).toBe(404);
  await reader.close();
  const limited = await browser.newContext({
    storageState: `${directory}/auth-page-only.json`,
  });
  expect(
    (
      await limited.request.get(
        `${f.base}api/procurement/supplierAvailability?subjectId=${f.companyA}`,
      )
    ).status(),
  ).toBe(403);
  await limited.close();
  const scopeOnly = await browser.newContext({
    storageState: `${directory}/auth-scope-only.json`,
  });
  const scopeView = await scopeOnly.newPage();
  await scopeView.goto(`${root}/directory`);
  await expect(
    scopeView
      .getByRole('button', { name: '编辑适用范围', exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    scopeView.getByRole('button', { name: '编辑公共资料', exact: true }),
  ).toHaveCount(0);
  await scopeView.screenshot({ path: `${shots}/scope-only-directory.png` });
  await scopeOnly.close();
  await page.getByRole('button', { name: '打开账户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: /语言/ }).hover();
  await page
    .getByRole('menuitemradio', { name: 'English', exact: true })
    .click();
  await page.goto(`${root}?subjectId=${f.companyA}`);
  await expect(
    page.getByRole('heading', { name: 'Suppliers', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(
    page.getByRole('link', { name: /华东设备供应商/ }),
  ).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${shots}/list-en.png` });
  await context.request.put(`${f.base}api/i18n/locale`, {
    headers: { Origin: new URL(f.base).origin },
    data: { locale: 'zh-CN' },
  });
  expect(errors).toEqual([]);
  await writeFile(
    `${shots}/capture-log.json`,
    JSON.stringify(
      {
        errors,
        checks: [
          'search typing/middle edits/Chinese IME',
          'no results',
          'two presets light/dark at 375px',
          'scope footer visible',
          '403/404 no retry',
          '500 retry',
          'reader UI',
          'page-only API denied',
          'en-US copy',
        ],
      },
      null,
      2,
    ),
  );
});

test('company picker, loading, network retry and URL pagination', async ({
  page,
}) => {
  const f = await fixture(),
    root = `${f.base}functions/procurement/suppliers`;
  await page.goto(root);
  await page.getByRole('button', { name: '先选择公司', exact: true }).click();
  const input = page.getByRole('textbox', { name: '搜索公司', exact: true });
  await input.pressSequentially('UI-PAGE');
  await page.getByText('UI-PAGE · 分页验收公司', { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`subjectId=${f.pageCompany}`));
  await expect(
    page.getByRole('link', { name: '分页供应商0', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(
    page.getByRole('link', { name: '分页供应商21', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('link', { name: '分页供应商21', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${shots}/pagination.png` });
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    '**/api/procurement/supplierAvailability?*',
    async (route) => {
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    },
  );
  await page.goto(`${root}?subjectId=${f.companyA}`);
  await expect(
    page.getByLabel('正在加载供应商', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${shots}/loading.png` });
  release!();
  await expect(page.getByRole('table')).toBeVisible();
  await page.unroute('**/api/procurement/supplierAvailability?*');
  await page.route('**/api/procurement/supplierAvailability?*', (route) =>
    route.abort('failed'),
  );
  await page.reload();
  await expect(
    page.getByRole('button', { name: '重试', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${shots}/network-error.png` });
  await page.unroute('**/api/procurement/supplierAvailability?*');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
});

test('read-only runtime audit has no new console errors or failed API requests', async ({
  page,
}) => {
  const f = await fixture(),
    root = `${f.base}functions/procurement/suppliers`,
    consoleErrors: string[] = [],
    pageErrors: string[] = [],
    failures: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().includes('/api/'))
      failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  await page.goto(f.base);
  await expect(page.locator('main')).toBeVisible();
  await page.waitForTimeout(300);
  const baseline = {
    consoleErrors: consoleErrors.splice(0),
    pageErrors: pageErrors.splice(0),
    failures: failures.splice(0),
  };
  for (const path of [
    `?subjectId=${f.companyA}`,
    `/${f.partnerId}?subjectId=${f.companyB}`,
    `/${f.partnerId}/scope?subjectId=${f.companyB}`,
    '/directory',
  ]) {
    await page.goto(root + path);
    if (path.includes('/scope'))
      await expect(
        page.getByRole('dialog').getByRole('textbox', { name: /修改原因/ }),
      ).toBeVisible();
    else if (path.includes('/directory'))
      await expect(
        page.getByRole('button', { name: '编辑适用范围', exact: true }).first(),
      ).toBeVisible();
    else
      await expect(
        page.getByRole('heading', { level: 1 }).last(),
      ).toBeVisible();
    await page.waitForTimeout(400);
  }
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failures).toEqual([]);
  await writeFile(
    `${shots}/runtime-audit.json`,
    JSON.stringify({ baseline, consoleErrors, pageErrors, failures }, null, 2),
  );
});

test('acceptance fixes: clear directory, audit scope, disabled restore and header sorting', async ({
  page,
}) => {
  const f = await fixture(),
    root = `${f.base}functions/procurement/suppliers`;
  await page.goto(
    `${root}/directory?subjectId=${f.companyA}&directoryQ=acceptance-no-match`,
  );
  await expect(
    page.getByRole('button', { name: '清除筛选', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${shots}/directory-no-results.png` });
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page).not.toHaveURL(/directoryQ/);
  await expect(
    page.getByRole('button', { name: '编辑适用范围', exact: true }).first(),
  ).toBeVisible();
  await page.goto(`${root}/${f.partnerId}?subjectId=${f.companyB}`);
  const history = page
    .locator('[data-slot=card]')
    .filter({ has: page.getByText('适用范围变更历史', { exact: true }) });
  const stop = history.locator('article').filter({ hasText: 'Global disable' });
  await stop.getByText('变更后', { exact: true }).click();
  await expect(
    stop.getByText('全部公司供应商状态', { exact: true }),
  ).toBeVisible();
  await expect(stop.getByText('本公司状态', { exact: true })).toHaveCount(0);
  await stop.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/global-history.png` });
  await page.route(
    '**/api/procurement/supplierAvailability/*?*',
    async (route) => {
      const response = await route.fetch(),
        payload = await response.json();
      await route.fulfill({
        response,
        json: {
          ...payload,
          data: {
            ...payload.data,
            companyStatus: 'inactive',
            supplierStatus: 'inactive',
            effectiveStatus: 'inactive',
          },
        },
      });
    },
  );
  await page.goto(`${root}/${f.partnerId}?subjectId=${f.companyB}`);
  await expect(
    page.getByRole('button', { name: '恢复本公司使用', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText('供应商已全局停用或公共身份未启用，须先恢复全局状态。', {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: `${shots}/restore-unavailable.png` });
  await page.unroute('**/api/procurement/supplierAvailability/*?*');
  await page.goto(`${root}?subjectId=${f.companyA}`);
  await page.getByRole('button', { name: '更新时间', exact: true }).click();
  await expect(page).toHaveURL(/orderBy=-updatedAt/);
  await expect(
    page.getByRole('columnheader', { name: '更新时间', exact: true }),
  ).toHaveAttribute('aria-sort', 'descending');
  await page.getByRole('button', { name: '更新时间', exact: true }).click();
  await expect(
    page.getByRole('columnheader', { name: '更新时间', exact: true }),
  ).toHaveAttribute('aria-sort', 'ascending');
});

/// <reference lib="dom" />
import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const dir = 'storage/ui-workflow/purchase-reference-coordination',
  shots = `${dir}/screenshots`;
interface Fixture {
  base: string;
  companyId: string;
  emptyCompanyId: string;
  unitId: string;
  employeeId: string;
  changeId: string;
  skuId: string;
  admissionId: string;
  nameId: string;
  supplierId: string;
  requestId: string;
  requestCode: string;
}
const fixture = async () =>
  JSON.parse(await readFile(`${dir}/fixture.json`, 'utf8')) as Fixture;
test.use({
  storageState: `${dir}/auth-admin.json`,
  viewport: { width: 1440, height: 1000 },
  actionTimeout: 15000,
});
const captures: unknown[] = [];
let errors: string[],
  http: { status: number; path: string }[],
  failed: string[];
test.beforeEach(({ page }) => {
  errors = [];
  http = [];
  failed = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource'))
      errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400)
      http.push({ status: r.status(), path: new URL(r.url()).pathname });
  });
  page.on('requestfailed', (r) => {
    if (!r.failure()?.errorText.includes('ABORTED'))
      failed.push(new URL(r.url()).pathname);
  });
});
test.afterEach(async ({ page: _page }, info) => {
  const intentional = info.title.includes('failure states')
    ? [400, 401, 403, 404, 500]
    : info.title.includes('organization blocks') ||
        info.title.includes('long confirmations')
      ? [400]
      : [];
  expect(errors).toEqual([]);
  expect(http.filter((r) => !intentional.includes(r.status))).toEqual([]);
  expect(failed).toEqual([]);
  captures.push({
    test: info.title,
    status: info.status,
    errors,
    http,
    failed,
  });
  await mkdir(shots, { recursive: true });
  await writeFile(
    `${shots}/capture-log.json`,
    JSON.stringify(captures, null, 2),
  );
});
const notice = (page: Page) =>
  page.locator('[data-purchase-references]').filter({ visible: true }).last();
const take = async (page: Page, name: string) => {
  await mkdir(shots, { recursive: true });
  await page
    .locator(
      '[data-slot=route-overlay-content]:visible, [data-slot=alert-dialog-content]:visible',
    )
    .evaluateAll(async (elements) => {
      await Promise.all(
        elements.flatMap((element) =>
          element
            .getAnimations()
            .map((animation) => animation.finished.catch(() => undefined)),
        ),
      );
    });
  await page.screenshot({
    path: `${shots}/${name}.png`,
    animations: 'disabled',
  });
};

test('organization blocks retirement inside the existing dialog and retains reason and filtered list', async ({
  page,
}) => {
  const f = await fixture(),
    root = `${f.base}organization/subjects?q=Purchase+company+A`;
  await page.goto(root);
  const row = page.getByRole('row').filter({ hasText: 'Purchase company A' });
  await row.getByRole('button', { name: /的操作/ }).click();
  await page.getByRole('menuitem', { name: '停用', exact: true }).click();
  await expect(notice(page).getByText(f.requestCode)).toBeVisible();
  const reason = page.locator('#status-reason');
  await reason.pressSequentially('review ');
  await reason.focus();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', {
    text: 'jiaojie',
    selectionStart: 7,
    selectionEnd: 7,
  });
  await cdp.send('Input.insertText', { text: '交接' });
  await expect(reason).toHaveValue('review 交接');
  await expect(reason).toBeFocused();
  const response = page.waitForResponse(
    (r) => r.url().includes('/setStatus') && r.request().method() === 'POST',
  );
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '停用', exact: true })
    .click();
  expect((await response).status()).toBe(400);
  await expect(
    page.getByRole('alert').getByText(/存在未完采购申请引用/),
  ).toBeVisible();
  await expect(reason).toHaveValue('review 交接');
  await take(page, 'organization-blocked');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await expect(page).toHaveURL(root);
});

test('existing people, supplier and material forms show references and stop supplier without rewriting purchase history', async ({
  page,
}) => {
  const f = await fixture();
  await page.goto(
    `${f.base}functions/personnel/changes/${f.changeId}/actions/submit`,
  );
  await expect(notice(page).getByText(f.requestCode)).toBeVisible();
  await page.locator('#people-action-reason').fill('后续协调交接');
  await take(page, 'people-change');
  await page.locator('#people-action-reason').fill('');
  await page.goto(
    `${f.base}functions/warehouse/materials/subjectSettings/edit/${f.admissionId}?subjectId=${f.companyId}`,
  );
  await expect(notice(page).getByText(f.requestCode)).toBeVisible();
  await notice(page).scrollIntoViewIfNeeded();
  await take(page, 'material-admission');
  const current = await (
    await page.request.get(`${f.base}api/procurement/requests/${f.requestId}`)
  ).json();
  await page.goto(
    `${f.base}functions/procurement/suppliers/${f.supplierId}/company/deactivate?subjectId=${f.companyId}`,
  );
  await expect(notice(page).getByText(f.requestCode)).toBeVisible();
  await page
    .locator('#supplier-action-reason')
    .fill('停用后由采购协调未完申请');
  await take(page, 'supplier-stop');
  const response = page.waitForResponse(
    (r) =>
      r.url().includes('/supplierOverrides') && r.request().method() === 'POST',
  );
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '停用', exact: true })
    .click();
  expect((await response).status()).toBe(200);
  const after = await (
    await page.request.get(`${f.base}api/procurement/requests/${f.requestId}`)
  ).json();
  for (const key of ['versions', 'reviewTasks', 'supplierSnapshot'])
    expect(after.data[key]).toEqual(current.data[key]);
});

test('readable light and dark presets at 375px and English, preserves input during retry and parent navigation', async ({
  page,
}) => {
  const f = await fixture(),
    root = `${f.base}functions/warehouse/materials/names?q=Reference`;
  await page.goto(
    `${f.base}functions/warehouse/materials/names/edit/${f.nameId}?q=Reference`,
  );
  await expect(notice(page).getByText(f.requestCode)).toBeVisible();
  for (const preset of ['default', 'compact'])
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
      await notice(page).scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      const bounds = await notice(page).boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(dark ? 375 : 1440);
      await take(page, `material-${preset}-${dark ? 'dark-mobile' : 'light'}`);
    }
  await page.getByRole('button', { name: '取消', exact: true }).last().click();
  await expect(page).toHaveURL(root);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '打开账户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: /语言/ }).hover();
  await page
    .getByRole('menuitemradio', { name: 'English', exact: true })
    .click();
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.goto(
    `${f.base}functions/warehouse/materials/names/edit/${f.nameId}`,
  );
  await expect(
    notice(page).getByRole('heading', { name: 'Open purchase references' }),
  ).toBeVisible();
  await expect(notice(page).getByText(f.requestCode)).toBeVisible();
  await take(page, 'material-english-mobile');
  await page.request.put(`${f.base}api/i18n/locale`, {
    data: { locale: 'zh-CN' },
    headers: { origin: new URL(f.base).origin },
  });
});

test('failure states loading, retry, 403, 404, too broad and 401 preserve the parent draft', async ({
  page,
}) => {
  const f = await fixture(),
    url = `${f.base}functions/warehouse/materials/names/edit/${f.nameId}`;
  let mode = 500;
  let release!: () => void;
  const loading = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route('**/api/procurement/referenceImpacts?*', async (route) => {
    if (first) {
      first = false;
      await loading;
    }
    if (mode === 200) await route.continue();
    else
      await route.fulfill({
        status: mode,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            status: mode === 401 ? 'UNAUTHENTICATED' : 'FAILED_PRECONDITION',
            message: 'Controlled reference failure',
            reason:
              mode === 400 ? 'PURCHASE_REFERENCE_TOO_BROAD' : 'REFERENCE_TEST',
          },
        }),
      });
  });
  await page.goto(url);
  await expect(
    notice(page).getByRole('status', { name: '加载中' }),
  ).toBeVisible();
  release();
  await expect(
    notice(page).getByRole('button', { name: '重试' }),
  ).toBeVisible();
  const reason = page.locator('#material-form-reason');
  await reason.pressSequentially('keep draft');
  mode = 200;
  await notice(page).getByRole('button', { name: '重试' }).click();
  await expect(notice(page).getByText(f.requestCode)).toBeVisible();
  await expect(reason).toHaveValue('keep draft');
  await reason.fill('');
  for (const [status, text] of [
    [403, '请联系管理员'],
    [404, '请关闭表单'],
    [400, '记录过多'],
    [401, '登录会话已结束'],
  ] as const) {
    mode = status;
    await page.reload();
    await expect(notice(page).getByText(new RegExp(text))).toBeVisible();
    expect(
      await notice(page).getByRole('button', { name: '重试' }).count(),
    ).toBe(0);
  }
  expect(await page.locator('#material-form-reason').isVisible()).toBe(true);
  await take(page, 'session-ended');
});

test('a maintenance-only account receives no existence or count and empty references explain the next step', async ({
  browser,
  page,
}) => {
  const f = await fixture();
  await page.goto(`${f.base}organization/subjects/edit/${f.emptyCompanyId}`);
  await expect(
    notice(page).getByText('暂无可查看的未完采购引用'),
  ).toBeVisible();
  const context = await browser.newContext({
    storageState: `${dir}/auth-restricted.json`,
  });
  const limited = await context.newPage();
  const response = limited.waitForResponse((r) =>
    r.url().includes('/referenceImpacts'),
  );
  await limited.goto(
    `${f.base}functions/warehouse/materials/names/edit/${f.nameId}`,
  );
  expect((await (await response).json()).data).toEqual({
    visibility: 'restricted',
    items: [],
    hasMore: false,
  });
  await expect(
    notice(limited).getByText(/采购引用不在你的查看权限内/),
  ).toBeVisible();
  await take(limited, 'restricted');
  await context.close();
});

test('long confirmations keep their footer visible at 375px with five references and a business error', async ({
  page,
}) => {
  const f = await fixture();
  await page.setViewportSize({ width: 375, height: 667 });
  await page.route('**/api/procurement/referenceImpacts?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          visibility: 'authorized',
          total: 5,
          hasMore: false,
          items: Array.from({ length: 5 }, (_, i) => ({
            id: `example-${i}`,
            code: `${f.requestCode}-LONG-REFERENCE-${i}`,
            status: 'pending',
          })),
        },
      }),
    }),
  );
  const cases = [
    {
      name: 'organization',
      url: `${f.base}organization/subjects?q=Purchase+company+A`,
      reason: '#status-reason',
    },
    {
      name: 'supplier',
      url: `${f.base}functions/procurement/suppliers/${f.supplierId}/company/reactivate?subjectId=${f.companyId}`,
      reason: '#supplier-action-reason',
    },
    {
      name: 'material',
      url: `${f.base}functions/warehouse/materials/subjectSettings/${f.admissionId}/actions/deactivate?subjectId=${f.companyId}`,
      reason: '#material-action-reason',
    },
    {
      name: 'people',
      url: `${f.base}functions/personnel/changes/${f.changeId}/actions/cancel`,
      reason: '#people-action-reason',
    },
  ];
  for (const item of cases) {
    await page.goto(item.url);
    if (item.name === 'organization') {
      await page
        .getByRole('row')
        .filter({ hasText: 'Purchase company A' })
        .getByRole('button', { name: /的操作/ })
        .click();
      await page.getByRole('menuitem', { name: '停用', exact: true }).click();
    }
    await expect(notice(page).locator('li')).toHaveCount(5);
    const dialog = page.getByRole('alertdialog'),
      footer = dialog.locator('[data-slot=alert-dialog-footer]');
    const bounds = await footer.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(667);
    const cancel = footer.getByRole('button', { name: '取消', exact: true });
    await cancel.focus();
    await cancel.press('Shift+Tab');
    await expect(page.locator(item.reason)).toBeFocused();
    const reasonBounds = await page.locator(item.reason).boundingBox();
    expect(reasonBounds!.y).toBeGreaterThanOrEqual(0);
    expect(reasonBounds!.y + reasonBounds!.height).toBeLessThanOrEqual(
      bounds!.y,
    );
    if (item.name === 'organization') {
      await page.locator(item.reason).fill('Five references layout check');
      await footer.getByRole('button', { name: '停用', exact: true }).click();
      await expect(
        dialog.getByRole('alert').getByText(/存在未完采购申请引用/),
      ).toBeVisible();
      const errorBounds = await footer.boundingBox();
      expect(errorBounds!.y + errorBounds!.height).toBeLessThanOrEqual(667);
      await page.locator(item.reason).fill('');
    }
    await take(page, `${item.name}-five-mobile`);
  }
});

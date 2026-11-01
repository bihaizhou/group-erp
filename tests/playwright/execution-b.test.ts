/// <reference lib="dom" />
import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
const dir = 'storage/ui-workflow/inventory',
  shots = `${dir}/screenshots`;
interface Fixture {
  base: string;
  companyId: string;
  purchaseId: string;
  purchaseCode: string;
  receiptId: string;
  receiptCode: string;
  salesId: string;
  countId: string;
  warehouseId: string;
  issueRequestCode: string;
}
const fixture = async () =>
  JSON.parse(await readFile(`${dir}/fixture.json`, 'utf8')) as Fixture;
test.use({
  storageState: `${dir}/auth-operator.json`,
  viewport: { width: 1440, height: 1000 },
  actionTimeout: 20000,
});
const take = async (page: Page, name: string) => {
  await mkdir(shots, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    );
  });
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
test('keeps the purchase order filters on one row and scopes rows to the chosen company', async ({
  page,
}) => {
  const f = await fixture(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(
    `${f.base}functions/procurement/orders?subjectId=${f.companyId}`,
  );
  await expect(
    page.getByRole('cell', { name: f.purchaseCode }).first(),
  ).toBeVisible({ timeout: 60000 });
  const filters = page.locator('main div.items-end').first();
  const tops = await filters.evaluate((element) =>
    [...element.children]
      .filter((child) => child.getBoundingClientRect().height > 20)
      .map((child) => Math.round(child.getBoundingClientRect().bottom)),
  );
  expect(tops.length).toBeGreaterThanOrEqual(5);
  expect(new Set(tops).size).toBe(1);
  await take(page, 'list-purchase-orders');
  expect(errors).toEqual([]);
});
test('opens a nested receipt document without querying it through the purchase order scope', async ({
  page,
}) => {
  const f = await fixture(),
    paths: string[] = [],
    errors: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) paths.push(path);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(
    `${f.base}functions/procurement/orders/${f.purchaseId}/documents/${f.receiptId}`,
  );
  await expect(
    page.getByRole('heading', { name: new RegExp(f.receiptCode) }),
  ).toBeVisible({ timeout: 90000 });
  expect(
    paths.filter((path) => path.includes(`/procurement/orders/${f.receiptId}`)),
  ).toEqual([]);
  expect(
    await page.locator('[data-slot=route-child-page]').count(),
  ).toBeGreaterThanOrEqual(2);
  await expect(page.getByText('当前范围内无法访问此记录。')).toHaveCount(0);
  await take(page, 'nested-receipt-document');
  expect(errors).toEqual([]);
});
test('labels every reservation field and cancels without leaving an overlay behind', async ({
  page,
}) => {
  const f = await fixture(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${f.base}functions/sales/orders/${f.salesId}/reserve`);
  const overlay = page.locator('[data-slot=route-overlay-content]');
  await expect(overlay).toBeVisible({ timeout: 60000 });
  for (const label of [
    '公司',
    '仓库',
    '已批准依据',
    '物料',
    '基准数量',
    '业务原因',
  ])
    await expect(
      overlay.getByText(label, { exact: false }).first(),
    ).toBeVisible();
  await take(page, 'reserve-dialog');
  await overlay.getByRole('button', { name: '取消', exact: true }).click();
  await expect(overlay).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('surfaces a 409 conflict and keeps the entered reason available for a re-read', async ({
  page,
}) => {
  const f = await fixture(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/procurement/orders/*/closeRemainder', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        errors: [{ message: '记录已变化', code: 'VERSION_CONFLICT' }],
      }),
    }),
  );
  await page.goto(
    `${f.base}functions/procurement/orders/${f.purchaseId}/actions/closeRemainder`,
  );
  const overlay = page.locator('[data-slot=route-overlay-content]');
  await expect(overlay).toBeVisible({ timeout: 90000 });
  await overlay.locator('[id^=execution-close-]').first().fill('6');
  await overlay
    .locator('#execution-action-reason')
    .fill('浏览器验收：竞争冲突');
  await overlay.getByRole('button', { name: '关闭余量', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '关闭余量', exact: true })
    .click();
  await expect(overlay.getByRole('button', { name: '读取最新' })).toBeVisible({
    timeout: 30000,
  });
  await expect(overlay.locator('#execution-action-reason')).toHaveValue(
    '浏览器验收：竞争冲突',
  );
  await take(page, 'action-conflict');
  await overlay.getByRole('button', { name: '读取最新' }).click();
  await expect(overlay.getByRole('button', { name: '读取最新' })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});
test('shows a document detail with its line values at 375px without horizontal overflow', async ({
  page,
}) => {
  const f = await fixture(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${f.base}functions/procurement/orders/${f.purchaseId}`);
  await expect(
    page.getByRole('heading', { level: 1, name: new RegExp(f.purchaseCode) }),
  ).toBeVisible({ timeout: 60000 });
  await expect(
    page.getByRole('columnheader', { name: '本次数量' }),
  ).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('10 个').first()).toBeVisible();
  await expect(page.locator('[data-slot=skeleton]')).toHaveCount(0);
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
  await take(page, 'purchase-detail-mobile');
  expect(errors).toEqual([]);
});

test('lists an approved issue request as an issue-outbound source without field-scope errors', async ({
  page,
}) => {
  const f = await fixture();
  await page.goto(
    `${f.base}functions/warehouse/outbounds/new?subjectId=${f.companyId}&warehouseId=${f.warehouseId}&kind=issue`,
    { waitUntil: 'networkidle' },
  );
  await page.getByRole('button', { name: '请选择' }).first().click();
  const popover = page.locator('[data-slot=popover-content]');
  await expect(popover.getByText(f.issueRequestCode)).toBeVisible();
  await expect(popover.getByText('你当前无法查看此部分')).toHaveCount(0);
  await take(page, 'issue-source-options');
  await page.keyboard.press('Escape');
});

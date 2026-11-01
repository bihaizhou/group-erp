/// <reference lib="dom" />
import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const dir = 'storage/ui-workflow/material-sources',
  auth = 'storage/ui-workflow/requisitions';
type Fixture = {
  base: string;
  companyId: string;
  offered: {
    domain: 'procurement' | 'requisitions';
    id: string;
    code: string;
    lineId: string;
    taskId: string;
  }[];
};
const fixture = async () =>
  JSON.parse(await readFile(`${auth}/fixture.json`, 'utf8')) as Fixture;
test.use({
  storageState: `${auth}/auth-applicant.json`,
  viewport: { width: 1440, height: 1000 },
});
const records: { test: string; errors: string[]; url: string }[] = [];
let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  await mkdir(`${dir}/screenshots`, { recursive: true });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 500)
      errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
});
test.afterEach(async ({ page }, info) => {
  records.push({ test: info.title, errors: [...errors], url: page.url() });
  await writeFile(`${dir}/capture-log.json`, JSON.stringify(records, null, 2));
  expect(errors).toEqual([]);
});
const active = (page: Page) =>
  page.locator('[data-slot=route-child-page]').last();
const shot = async (page: Page, name: string) => {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    );
  });
  await page.screenshot({
    path: `${dir}/screenshots/${name}.png`,
    fullPage: true,
  });
};
for (const domain of ['procurement', 'requisitions'] as const)
  test(`${domain} confirms a locked candidate with exact packaging and preserves conflict input`, async ({
    page,
  }) => {
    const f = await fixture(),
      row = f.offered.find((r) => r.domain === domain)!;
    await page.goto(
      `${f.base}functions/${domain}/requests/${row.id}?subjectId=${f.companyId}`,
    );
    await expect(active(page).getByText('待确认', { exact: true })).toBeVisible(
      { timeout: 15000 },
    );
    await expect(active(page).getByText(/候选尚未改变需求内容/u)).toBeVisible();
    await active(page)
      .getByRole('button', { name: '办理历史', exact: true })
      .click();
    await expect(active(page).getByText('第1轮', { exact: true })).toHaveCount(
      2,
    );
    await shot(page, `${domain}-offered-detail`);
    await active(page)
      .getByRole('button', { name: '确认物料', exact: true })
      .click();
    await page.reload();
    await expect(
      page.locator('[data-slot=route-overlay-content]').getByRole('heading', {
        name: new RegExp(`确认物料.*${row.code}`, 'u'),
      }),
    ).toBeVisible({ timeout: 15000 });
    const dialog = page.locator('[data-slot=route-overlay-content]');
    await dialog.locator('#source-confirm-unit').click();
    await page.getByRole('option', { name: /每箱12件/u }).click();
    await expect(
      dialog.getByText('基准数量: 240 个', { exact: true }),
    ).toBeVisible();
    await dialog
      .locator('#source-action-reason')
      .pressSequentially('已核对候选和实际包装');
    let writes = 0;
    const mutationPath = `**/api/${domain}/requests/${row.id}/lines/${row.lineId}/confirmMaterial`;
    await page.route(mutationPath, async (route) => {
      writes++;
      if (domain === 'procurement' && writes === 1)
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              status: 'ABORTED',
              domain: 'supplyChain',
              reason: 'SUPPLY_SOURCE_VERSION_CONFLICT',
              message: 'Opaque server detail',
            },
          }),
        });
      else await route.continue();
    });
    const confirm = async () => {
      await dialog
        .getByRole('button', { name: '确认物料', exact: true })
        .click();
      const prompt = page.getByRole('alertdialog');
      await expect(prompt).toContainText(row.code);
      await prompt
        .getByRole('button', { name: '确认物料', exact: true })
        .click();
    };
    await confirm();
    if (domain === 'procurement') {
      await expect(dialog.locator('#source-action-reason')).toHaveValue(
        '已核对候选和实际包装',
      );
      await expect(
        dialog.getByRole('button', { name: '确认物料', exact: true }),
      ).toBeDisabled();
      await dialog
        .getByRole('button', { name: '读取最新记录', exact: true })
        .click();
      await dialog
        .getByRole('button', { name: '采用此记录并重新确认', exact: true })
        .click();
      await dialog.locator('#source-confirm-unit').click();
      await page.getByRole('option', { name: /每箱12件/u }).click();
      await expect(
        dialog.getByText('基准数量: 240 个', { exact: true }),
      ).toBeVisible();
      await shot(page, 'confirmation-conflict-recovered');
      await confirm();
    }
    await expect(page).toHaveURL(new RegExp(`/requests/${row.id}\\?`, 'u'));
    await expect(
      active(page).getByText('已确认', { exact: true }),
    ).toBeVisible();
    expect(writes).toBe(domain === 'procurement' ? 2 : 1);
    const saved = await (
      await page.request.get(`${f.base}api/${domain}/requests/${row.id}`)
    ).json();
    expect(saved.data.status).toBe('draft');
    expect(saved.data.lines[0].baseQuantity).toBe('240');
    expect(saved.data.versions).toHaveLength(1);
    expect(saved.data.versions[0].payload.lines[0].skuId).toBeNull();
    await shot(page, `${domain}-confirmed-draft`);
  });

test('governance task shows minimal source with no direct source editing', async ({
  browser,
}) => {
  const f = await fixture(),
    row = f.offered[0],
    context = await browser.newContext({
      storageState: `${auth}/auth-admin.json`,
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  await page.goto(
    `${f.base}functions/warehouse/materials/requests/${row.taskId}`,
  );
  await expect(page.getByText('来源需求', { exact: true })).toBeVisible();
  await expect(page.getByText(/采购需求 · PR-/u)).toBeVisible();
  await expect(page.getByText(/请在原需求明细中修改内容/u)).toBeVisible();
  await expect(
    page.getByRole('link', { name: '编辑', exact: true }),
  ).toHaveCount(0);
  await shot(page, 'governance-minimal-source');
  await context.close();
});

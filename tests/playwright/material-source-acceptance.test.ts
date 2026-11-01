/// <reference lib="dom" />
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
const dir = 'storage/ui-workflow/material-sources',
  auth = 'storage/ui-workflow/requisitions';
interface Fixture {
  base: string;
  companyId: string;
  mixedId: string;
  offered: { domain: string; id: string; taskId: string; lineId: string }[];
}
const fixture = async () =>
  JSON.parse(await readFile(`${auth}/fixture.json`, 'utf8')) as Fixture;
test.use({
  storageState: `${auth}/auth-applicant.json`,
  viewport: { width: 1440, height: 1000 },
  actionTimeout: 15000,
});
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
test('a failed file cannot unlock the request while another upload is still active', async ({
  page,
}) => {
  const f = await fixture();
  const template = (
    await (
      await page.request.get(`${f.base}api/requisitions/requests/${f.mixedId}`)
    ).json()
  ).data;
  const created = await page.request.post(
    `${f.base}api/requisitions/requests`,
    {
      headers: { Origin: new URL(f.base).origin },
      data: {
        requestKey: randomUUID(),
        content: {
          subjectId: template.subjectId,
          requesterEmployeeId: template.requesterEmployeeId,
          recipientEmployeeId: template.recipientEmployeeId,
          requestingUnitId: template.requestingUnitId,
          purposeId: template.purposeId,
          usage: template.usage,
          neededOn: template.neededOn,
          projectId: null,
          notes: template.notes,
          attachments: [],
          lines: template.lines.map((line: { selectionInput: object }) => ({
            ...line.selectionInput,
            id: randomUUID(),
          })),
        },
      },
    },
  );
  expect(created.status()).toBe(201);
  const row = (await created.json()).data;
  const url = `${f.base}functions/requisitions/requests/${row.id}/edit?subjectId=${f.companyId}`;
  await page.goto(url);
  const form = page.locator('#issue-request-form');
  await expect(form.locator('#issue-reason')).toBeVisible({ timeout: 15000 });
  await form.locator('#issue-reason').pressSequentially('补充验收附件');
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/supplyChainFiles/uploadOne**', async (route) => {
    if (
      route
        .request()
        .postDataBuffer()
        ?.toString()
        .includes('filename="sample.png"')
    )
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            status: 'INTERNAL',
            reason: 'TEMPORARY_FAILURE',
            domain: 'app',
            message: 'Opaque upload failure',
          },
        }),
      });
    else {
      await gate;
      await route.continue();
    }
  });
  try {
    await form
      .locator('[data-demand-attachment-upload] input[type=file]')
      .setInputFiles([
        'tests/fixtures/demand-files/sample.png',
        'tests/fixtures/demand-files/sample.webp',
      ]);
    await expect(
      form.getByRole('button', { name: '重试: sample.png', exact: true }),
    ).toBeVisible();
    await expect(
      form.getByRole('button', { name: '保存', exact: true }),
    ).toBeDisabled();
    await expect(
      form.getByRole('button', { name: '取消', exact: true }),
    ).toBeDisabled();
    await page
      .locator('[data-slot=route-child-page]')
      .last()
      .getByRole('link', { name: '返回', exact: true })
      .click();
    await expect(page).toHaveURL(url);
    await shot(page, 'attachment-partial-failure-still-uploading');
  } finally {
    release();
  }
  await expect(form.locator('[data-slot=file-list] li')).toHaveCount(1, {
    timeout: 15000,
  });
  await expect(
    form.getByRole('button', { name: '保存', exact: true }),
  ).toBeEnabled();
  await expect(
    form.getByRole('button', { name: '取消', exact: true }),
  ).toBeEnabled();
});
for (const domain of ['procurement', 'requisitions'])
  test(`${domain} frozen version keeps its source history without current actions`, async ({
    page,
  }) => {
    const f = await fixture(),
      ref = f.offered.find((row) => row.domain === domain)!;
    const row = (
      await (
        await page.request.get(`${f.base}api/${domain}/requests/${ref.id}`)
      ).json()
    ).data;
    const parent = `${f.base}functions/${domain}/requests/${row.id}?subjectId=${f.companyId}`;
    await page.goto(
      `${f.base}functions/${domain}/requests/${row.id}/versions/${row.versions[0].id}?subjectId=${f.companyId}`,
    );
    const view = page.locator('[data-slot=route-child-page]').last();
    await expect(view.locator('[id^=source-line-]')).toHaveCount(1, {
      timeout: 15000,
    });
    await expect(
      view.getByRole('button', { name: '确认物料', exact: true }),
    ).toHaveCount(0);
    await view.getByRole('button', { name: '办理历史', exact: true }).click();
    await expect(view.getByText('第1轮', { exact: true })).toBeVisible();
    await expect(view.getByText('待确认', { exact: true })).toBeVisible();
    await shot(page, `${domain}-frozen-source-history`);
    await view.getByRole('link', { name: '返回', exact: true }).click();
    await expect(page).toHaveURL(parent);
  });
test('multiple offered lines use secondary entry actions', async ({ page }) => {
  const f = await fixture(),
    ref = f.offered[0];
  await page.route(`**/api/procurement/requests/${ref.id}`, async (route) => {
    const response = await route.fetch(),
      body = await response.json(),
      line = body.data.lines[0];
    body.data.lines.push({ ...line, id: randomUUID(), lineNo: 2 });
    await route.fulfill({ response, json: body });
  });
  await page.goto(
    `${f.base}functions/procurement/requests/${ref.id}?subjectId=${f.companyId}`,
  );
  const view = page.locator('[data-slot=route-child-page]').last();
  // The display-only second line deliberately points to the same offered source.
  await expect(
    view.getByRole('button', { name: '确认物料', exact: true }),
  ).toHaveCount(2, { timeout: 15000 });
  for (const button of await view
    .getByRole('button', { name: '确认物料', exact: true })
    .all())
    await expect(button).not.toHaveClass(/bg-primary/u);
  await shot(page, 'multiple-candidates-secondary-actions');
});
test('task refresh includes attachment metadata and retains previous content after a temporary source error', async ({
  browser,
}) => {
  const f = await fixture(),
    task = f.offered[0].taskId,
    context = await browser.newContext({
      storageState: `${auth}/auth-admin.json`,
    }),
    page = await context.newPage();
  let reads = 0,
    files = 0,
    fail = false;
  await page.route(
    `**/api/materials/requests/${task}/sources`,
    async (route) => {
      reads++;
      if (fail)
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              status: 'INTERNAL',
              reason: 'TEMPORARY_FAILURE',
              domain: 'app',
              message: 'Opaque source read failure',
            },
          }),
        });
      else await route.continue();
    },
  );
  page.on('request', (request) => {
    if (
      request.url().includes('/supplyChainFiles/findMany') &&
      request.url().includes(`governanceTaskId=${task}`)
    )
      files++;
  });
  try {
    await page.goto(`${f.base}functions/warehouse/materials/requests/${task}`);
    await expect(page.getByText('当前办理人', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect.poll(() => files).toBe(1);
    const beforeReads = reads,
      beforeFiles = files;
    const refresh = page
      .locator('[data-slot=route-child-page]')
      .last()
      .getByRole('button', { name: '刷新', exact: true });
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await expect.poll(() => reads).toBeGreaterThan(beforeReads);
    await expect.poll(() => files).toBeGreaterThan(beforeFiles);
    await expect(refresh).toBeEnabled();
    fail = true;
    await refresh.click();
    await expect(
      page.getByText('操作未能完成，请保留填写内容后重试。', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('当前办理人', { exact: true })).toBeVisible();
    await expect(page.getByText('需求附件', { exact: true })).toBeVisible();
    await expect(
      page.getByText('仅显示申请方明确分享的明细附件。', { exact: true }),
    ).toBeVisible();
    await shot(page, 'task-refresh-failure-retains-source-and-files');
    fail = false;
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(
      page.getByText('操作未能完成，请保留填写内容后重试。', { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText('当前办理人', { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

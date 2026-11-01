/// <reference lib="dom" />
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
const auth = 'storage/ui-workflow/requisitions';
const dir = 'storage/ui-workflow/material-sources';
const fixture = async () =>
  JSON.parse(await readFile(`${auth}/fixture.json`, 'utf8')) as {
    base: string;
    companyId: string;
    mixedId: string;
  };
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
test('identification submission preserves IME input, blocks repeat actions and retries only reading a committed result', async ({
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
  const row = (await created.json()).data,
    line = row.lines[1],
    url = `${f.base}functions/requisitions/requests/${row.id}/lines/${line.id}/governance/requestGovernance?subjectId=${f.companyId}`;
  await page.goto(url);
  const dialog = page.locator('[data-slot=route-overlay-content]'),
    reason = dialog.locator('#source-action-reason'),
    submit = dialog.getByRole('button', { name: '提报治理', exact: true });
  await expect(reason).toBeVisible({ timeout: 15000 });
  await submit.click();
  await expect(reason).toBeFocused();
  await reason.pressSequentially('核对规格');
  await reason.press('Home');
  const cdp = await page.context().newCDPSession(page);
  for (const text of ['jian', 'jianxiu'])
    await cdp.send('Input.imeSetComposition', {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    });
  await cdp.send('Input.insertText', { text: '检修' });
  await cdp.detach();
  await expect(reason).toHaveValue('检修核对规格');
  let writes = 0,
    committed = false,
    release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `**/api/requisitions/requests/${row.id}/lines/${line.id}/requestGovernance`,
    async (route) => {
      writes++;
      await gate;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      committed = true;
      await route.fulfill({ response });
    },
  );
  const readPattern = `**/api/requisitions/requests/${row.id}`;
  await page.route(readPattern, async (route) => {
    if (committed && route.request().method() === 'GET')
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            status: 'INTERNAL',
            domain: 'app',
            reason: 'TEMPORARY_FAILURE',
            message: 'Opaque test detail',
          },
        }),
      });
    else await route.continue();
  });
  await submit.click();
  await expect.poll(() => writes).toBe(1);
  await expect(
    dialog.getByRole('button', { name: /提报治理$/u }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole('button', { name: '取消', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(reason).toBeVisible();
  await shot(page, 'source-submitting-guard');
  release();
  await expect(
    dialog.getByText('操作已成功，请读取最新记录查看结果，无需再次提交操作。', {
      exact: true,
    }),
  ).toBeVisible({ timeout: 15000 });
  const read = dialog.getByRole('button', {
    name: '读取办理结果',
    exact: true,
  });
  await expect(read).toBeEnabled();
  await expect(
    dialog.getByText('操作未能完成，请保留填写内容后重试。', { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: '重试', exact: true }),
  ).toHaveCount(0);
  await expect(reason).toHaveValue('检修核对规格');
  await expect(reason).toBeDisabled();
  await shot(page, 'source-committed-read-failure');
  expect(writes).toBe(1);
  await page.unroute(readPattern);
  await read.click();
  await expect(page).toHaveURL(new RegExp(`/requests/${row.id}\\?`, 'u'));
  await expect(page.locator(`[id="source-line-${line.id}"]`)).toBeFocused();
  await expect(
    page
      .locator('[data-slot=route-child-page]')
      .last()
      .getByText('治理中', { exact: true }),
  ).toBeVisible();
  expect(writes).toBe(1);
});

test('attachments and governance remain usable in both presets, narrow dark mode and English', async ({
  page,
}) => {
  const f = await fixture(),
    files = JSON.parse(
      await readFile(`${dir}/attachment-browser-result.json`, 'utf8'),
    ) as { requestId: string };
  const url = `${f.base}functions/requisitions/requests/${files.requestId}?subjectId=${f.companyId}`;
  await page.goto(url);
  const detail = page.locator('[data-slot=route-child-page]').last();
  await expect(detail.locator('[data-slot=file-list] li')).toHaveCount(7);
  for (const preset of ['default', 'compact'])
    for (const dark of [false, true]) {
      await page.evaluate(
        ({ preset, dark }) => {
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
      await expect(detail.locator('[data-slot=file-list] li')).toHaveCount(7);
      await expect(page.locator('html')).toHaveAttribute('data-theme', preset);
      await expect(page.locator('html')).toHaveClass(
        new RegExp(dark ? 'dark' : 'light', 'u'),
      );
      await detail.locator('[data-slot=file-list]').scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await shot(
        page,
        `attachments-${preset}-${dark ? 'dark-mobile' : 'light'}`,
      );
    }
  try {
    await page
      .getByRole('button', { name: '打开账户菜单', exact: true })
      .click();
    await page.getByRole('menuitem', { name: /语言/u }).hover();
    await page
      .getByRole('menuitemradio', { name: 'English', exact: true })
      .click();
    await page.goto(url);
    await expect(
      detail.getByText('Demand attachments', { exact: true }),
    ).toBeVisible();
    await expect(
      detail.getByText('Shared with governance', { exact: false }),
    ).toHaveCount(1);
    await detail.locator('[data-slot=file-list]').scrollIntoViewIfNeeded();
    await shot(page, 'attachments-en-dark-mobile');
    const button = detail.getByRole('button', {
      name: 'Request identification',
      exact: true,
    });
    await button.click();
    const dialog = page.locator('[data-slot=route-overlay-content]');
    await expect(dialog.locator('#source-action-reason')).toBeVisible();
    await expect(dialog.getByText('Reason *', { exact: true })).toBeVisible();
    expect(
      await dialog
        .getByRole('heading')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await shot(page, 'source-en-dark-mobile');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(url);
  } finally {
    await page.request.put(`${f.base}api/i18n/locale`, {
      headers: { Origin: new URL(f.base).origin },
      data: { locale: 'zh-CN' },
    });
  }
});

for (const status of [401, 403, 404, 500, 'network'] as const)
  test(`source opening offers the correct recovery for ${status}`, async ({
    page,
  }) => {
    const f = await fixture();
    const row = (
      await (
        await page.request.get(
          `${f.base}api/requisitions/requests/${f.mixedId}`,
        )
      ).json()
    ).data;
    const pattern = `**/api/requisitions/requests/${row.id}/sources`;
    await page.route(pattern, (route) =>
      status === 'network'
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
                domain: 'app',
                reason: 'ISOLATED_FAILURE',
                message: 'Opaque test detail',
              },
            }),
          }),
    );
    const parent = `${f.base}functions/requisitions/requests/${row.id}?subjectId=${f.companyId}`;
    await page.goto(
      `${f.base}functions/requisitions/requests/${row.id}/lines/${row.lines[1].id}/governance/requestGovernance?subjectId=${f.companyId}`,
    );
    const dialog = page.locator('[data-slot=route-overlay-content]');
    const message =
      status === 401
        ? '登录会话已结束，请重新登录后继续。'
        : status === 403
          ? '当前已无此操作权限。'
          : status === 404
            ? '该申请或明细已不可用。'
            : '操作未能完成，请保留填写内容后重试。';
    await expect(dialog.getByText(message, { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(dialog.locator('#source-action-reason')).toHaveCount(0);
    if (status === 401)
      await expect(
        dialog.getByRole('button', { name: '重新登录', exact: true }),
      ).toBeVisible();
    else if (status === 403 || status === 404)
      await expect(
        dialog.getByRole('button', { name: '重试', exact: true }),
      ).toHaveCount(0);
    else {
      await shot(page, `source-opening-${status}`);
      await page.unroute(pattern);
      await dialog.getByRole('button', { name: '重试', exact: true }).click();
      await expect(dialog.locator('#source-action-reason')).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(parent);
  });

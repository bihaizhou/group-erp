/// <reference lib="dom" />
import { test, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directory = 'storage/ui-workflow/human-resources';
type Fixture = {
  base: string;
  profileId: string;
  personId: string;
  evaluationId: string;
  developmentId: string;
  modelId: string;
};
test.use({
  actionTimeout: 10000,
  viewport: { width: 1440, height: 1000 },
  storageState: `${directory}/auth.json`,
});
test('talent cards, edit flows, preserved filters, permissions and responsive themes', async ({
  page,
  context,
}) => {
  const fixture = JSON.parse(
    await readFile(`${directory}/fixture.json`, 'utf8'),
  ) as Fixture;
  const base = fixture.base;
  const currentResponse = await context.request.get(
    new URL(`api/people/profiles/${fixture.profileId}`, base).href,
  );
  expect(currentResponse.ok()).toBe(true);
  const current = (await currentResponse.json()).data;
  if (current.data.grade !== 3) {
    const reset = await context.request.patch(
      new URL(`api/people/profiles/${fixture.profileId}`, base).href,
      {
        headers: { origin: new URL(base).origin },
        data: {
          version: current.version,
          reason: '隔离验收前恢复等级',
          data: { ...current.data, grade: 3 },
        },
      },
    );
    expect(reset.ok()).toBe(true);
  }
  const screenshots = path.join(directory, 'screenshots');
  await mkdir(screenshots, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await expect(page.locator('h1')).toBeVisible();
  if ((await page.locator('h1').innerText()) === 'Group ERP') {
    await page.getByRole('button', { name: 'Open account menu' }).click();
    await page.getByRole('menuitem', { name: /Language/ }).hover();
    await page.getByRole('menuitemradio', { name: /中文/ }).click();
    await expect(page.locator('h1')).toHaveText('集团 ERP');
  }
  await page.screenshot({
    path: `${screenshots}/home-light.png`,
    fullPage: true,
  });
  const baselineErrors = [...errors];
  errors.length = 0;
  await page.goto(new URL('human-resources/profiles', base).href);
  await expect(page.locator('h1')).toHaveText('员工人才卡');
  const search = page.getByPlaceholder('搜索名称或编码');
  await search.click();
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/api/people/profiles'))
      requests.push(url.searchParams.get('q') ?? '');
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', {
    text: 'yanshou',
    selectionStart: 7,
    selectionEnd: 7,
  });
  await page.waitForTimeout(400);
  expect(requests).not.toContain('yanshou');
  await cdp.send('Input.insertText', { text: '验收' });
  await expect(page).toHaveURL(/q=/);
  await expect(
    page.getByRole('link', { name: '验收员工', exact: true }),
  ).toBeVisible();
  const listUrl = page.url();
  await page.getByRole('link', { name: '验收员工', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: '验收员工', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: /雷达图/ })).toBeVisible();
  await expect(
    page.getByRole('img', { name: /雷达图/ }).locator('svg'),
  ).toBeVisible();
  await expect(page.getByText('3 级', { exact: true }).last()).toBeVisible();
  await page.screenshot({
    path: `${screenshots}/talent-card-light.png`,
    fullPage: true,
  });
  let talentRefreshes = 0;
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.endsWith(
        `/api/people/talent/${fixture.personId}`,
      )
    )
      talentRefreshes++;
  });
  await page.getByRole('button', { name: '刷新', exact: true }).last().click();
  await expect.poll(() => talentRefreshes).toBeGreaterThan(0);
  const cardUrl = page.url();
  await page
    .getByRole('link', { name: '年度人才评价（验收）', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: '年度人才评价（验收）',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(
      `/profiles/${fixture.profileId}/evaluations/${fixture.evaluationId}`,
    ),
  );
  await page.screenshot({
    path: `${screenshots}/evaluation-history.png`,
    fullPage: true,
  });
  await page.getByRole('link', { name: '返回', exact: true }).last().click();
  await expect(page).toHaveURL(cardUrl);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page).toHaveURL(/\/edit\?/);
  const grade = page.getByLabel('员工等级', { exact: true });
  await grade.fill('6');
  await page
    .getByLabel('原因／意见 *', { exact: true })
    .pressSequentially('本地验收等级校验');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('请填写有效值。', { exact: true })).toBeVisible();
  await grade.fill('4');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page).toHaveURL(cardUrl);
  await expect(page.getByText('4 级', { exact: true }).last()).toBeVisible();
  await page.getByRole('link', { name: '返回', exact: true }).last().click();
  await expect(page).toHaveURL(listUrl);
  await expect(page.getByPlaceholder('搜索名称或编码')).toHaveValue('验收');
  await page.reload();
  await expect(page.getByPlaceholder('搜索名称或编码')).toHaveValue('验收');
  await page.getByPlaceholder('搜索名称或编码').fill('完全不存在的员工');
  await expect(page.getByText('没有匹配的资料', { exact: true })).toBeVisible();
  await page.screenshot({
    path: `${screenshots}/profiles-no-results.png`,
    fullPage: true,
  });
  await page
    .getByRole('button', { name: '清除筛选', exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('link', { name: '验收员工', exact: true }),
  ).toBeVisible();
  await page.goto(new URL('human-resources/workforcePlans', base).href);
  await expect(
    page.getByText('尚无集团人力规划', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${screenshots}/workforce-empty.png`,
    fullPage: true,
  });
  await page.goto(
    new URL(`human-resources/profiles/${fixture.profileId}`, base).href,
  );
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(
    page.getByRole('heading', { level: 1, name: '验收员工', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `${screenshots}/talent-card-mobile.png`,
    fullPage: true,
  });
  const mobileRadar = page.getByRole('img', { name: /雷达图/ });
  await mobileRadar.scrollIntoViewIfNeeded();
  await expect
    .poll(async () =>
      mobileRadar.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return Array.from(element.querySelectorAll('svg text')).every(
          (text) => {
            const rect = text.getBoundingClientRect();
            return (
              rect.left >= bounds.left - 1 &&
              rect.right <= bounds.right + 1 &&
              rect.top >= bounds.top - 1 &&
              rect.bottom <= bounds.bottom + 1
            );
          },
        );
      }),
    )
    .toBe(true);
  await page.screenshot({
    path: `${screenshots}/talent-radar-mobile.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole('heading', { level: 1, name: '验收员工', exact: true })
    .scrollIntoViewIfNeeded();
  // Use the application's own appearance control rather than changing CSS classes directly.
  await page.getByRole('button', { name: /外观|Appearance/ }).click();
  await page
    .getByRole('radio', { name: /深色|Dark/ })
    .locator('..')
    .click();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({
    path: `${screenshots}/talent-card-dark.png`,
    fullPage: true,
  });
  const response = await context.request.get(
    new URL('api/people/profiles', base).href,
  );
  expect(response.status()).toBe(200);
  expect(errors).toEqual([]);
  await writeFile(
    `${directory}/screenshots/browser-results.json`,
    JSON.stringify(
      {
        baselineErrors,
        errors,
        cardUrl,
        listUrl,
        checks: [
          'IME',
          'radar',
          'grade validation',
          'save refresh',
          'nested evaluation route',
          'filtered return',
          'reload',
          'no results',
          'empty',
          'mobile',
          'dark',
        ],
      },
      null,
      2,
    ),
  );
});

test('read-only role, English copy, alternate preset and denied writes', async ({
  browser,
}) => {
  const fixture = JSON.parse(
    await readFile(`${directory}/fixture.json`, 'utf8'),
  ) as Fixture;
  const context = await browser.newContext({
    storageState: `${directory}/auth-limited.json`,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(new URL('human-resources/profiles', fixture.base).href);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Employee talent cards',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /New employee talent card/i }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: '验收员工', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: '验收员工', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Edit', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: `${directory}/screenshots/talent-card-readonly-en.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Appearance', exact: true }).hover();
  await page
    .getByRole('radio', { name: 'Spacious', exact: true })
    .locator('..')
    .click();
  await page.keyboard.press('Escape');
  await page.screenshot({
    path: `${directory}/screenshots/talent-card-spacious-en.png`,
    fullPage: true,
  });
  const denied = await context.request.post(
    new URL('api/people/profiles', fixture.base).href,
    { headers: { origin: new URL(fixture.base).origin }, data: {} },
  );
  expect(denied.status()).toBe(403);
  expect(errors).toEqual([]);
  await context.close();
  const anonymous = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  expect(
    (
      await anonymous.request.get(
        new URL('api/people/profiles', fixture.base).href,
      )
    ).status(),
  ).toBe(401);
  await anonymous.close();
});

test('loading, retryable failure and non-retryable denied or missing data', async ({
  page,
}) => {
  const fixture = JSON.parse(
    await readFile(`${directory}/fixture.json`, 'utf8'),
  ) as Fixture;
  const pattern = /\/api\/people\/profiles(?:\?.*)?$/;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(pattern, async (route) => {
    await pending;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { status: 'INTERNAL', message: 'Simulated acceptance failure' },
      }),
    });
  });
  await page.goto(new URL('human-resources/profiles', fixture.base).href);
  await expect(page.locator('[data-slot="skeleton"]').first()).toBeVisible();
  await page.screenshot({
    path: `${directory}/screenshots/profiles-loading-en.png`,
    fullPage: true,
  });
  release();
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${directory}/screenshots/profiles-failure-en.png`,
    fullPage: true,
  });
  await page.unroute(pattern);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    page.getByRole('link', { name: '验收员工', exact: true }),
  ).toBeVisible();
  for (const status of [403, 404]) {
    await page.route(pattern, (route) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            status: status === 403 ? 'PERMISSION_DENIED' : 'NOT_FOUND',
            message: 'Simulated acceptance failure',
          },
        }),
      }),
    );
    await page.reload();
    await expect(
      page.getByText(
        status === 403
          ? 'You do not have access. Contact an administrator.'
          : 'This record does not exist or is outside your access. Return to the list.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Retry', exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: `${directory}/screenshots/profiles-${status}-en.png`,
      fullPage: true,
    });
    await page.unroute(pattern);
  }
  const optionsPattern = /\/api\/people\/options(?:\?.*)?$/;
  await page.route(optionsPattern, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { status: 'INTERNAL', message: 'Simulated option failure' },
      }),
    }),
  );
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${directory}/screenshots/options-failure-en.png`,
    fullPage: true,
  });
  await page.unroute(optionsPattern);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    page.getByRole('link', { name: '验收员工', exact: true }),
  ).toBeVisible();
});

test('workflow submission preserves next actions and history, with inline validation and first-error focus', async ({
  page,
}) => {
  const fixture = JSON.parse(
    await readFile(`${directory}/fixture.json`, 'utf8'),
  ) as Fixture;
  const detail = new URL(
    `human-resources/developmentPlans/${fixture.developmentId}`,
    fixture.base,
  ).href;
  await page.goto(detail);
  await page
    .getByRole('button', { name: 'Update progress', exact: true })
    .click();
  const dialog = page.getByRole('dialog').last();
  await dialog
    .getByLabel('Progress', { exact: true })
    .fill('Browser workflow regression');
  await dialog
    .getByLabel('Reason or comment *', { exact: true })
    .fill('Preserve workflow metadata after save');
  await dialog
    .getByRole('button', { name: 'Update progress', exact: true })
    .click();
  await expect(page).toHaveURL(detail);
  await expect(
    page.getByRole('button', { name: 'Update progress', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Processing history', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText('Preserve workflow metadata after save', { exact: true })
      .last(),
  ).toBeVisible();
  await page.screenshot({
    path: `${directory}/screenshots/development-after-progress-en.png`,
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Complete development', exact: true })
    .click();
  const completion = page.getByRole('dialog').last();
  await completion.getByLabel('Result', { exact: true }).fill('');
  await completion
    .getByLabel('Reason or comment *', { exact: true })
    .fill('Check required completion evidence');
  await completion
    .getByRole('button', { name: 'Complete development', exact: true })
    .click();
  await expect(
    completion.getByText('Enter this value.', { exact: true }),
  ).toBeVisible();
  await expect(completion.getByLabel('Result', { exact: true })).toBeFocused();
  await page.screenshot({
    path: `${directory}/screenshots/development-required-result-en.png`,
    fullPage: true,
  });
  await completion.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(detail);
  await page.goto(new URL('human-resources/history', fixture.base).href);
  await page
    .getByPlaceholder('Search by name or code')
    .fill('No matching audit acceptance row');
  await expect(
    page.getByText('No matching records', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await expect(page.getByPlaceholder('Search by name or code')).toHaveValue('');
  await expect(page.getByPlaceholder('Search by name or code')).toBeFocused();
});

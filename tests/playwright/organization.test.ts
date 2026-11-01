/// <reference lib="dom" />
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { DEFAULT_ADMIN_CREDENTIALS } from '@nocobase/app-plugin-authentication/testing';

test.use({ channel: 'chromium', viewport: { width: 1440, height: 1000 } });
test('organization create/edit, navigation, input and responsive views', async ({
  page,
  context,
}) => {
  const base = process.env.APP_URL;
  if (!base)
    throw new Error('Set APP_URL to the Local URL printed by pnpm dev.');
  const origin = new URL(base).origin;
  // The development-only annotation overlay can cover modal footers at 375px.
  // It is absent from production; keep it from intercepting application input in this test.
  await page.addInitScript(() =>
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent =
        '#agent-annotations-root { pointer-events: none !important; }';
      document.head.appendChild(style);
    }),
  );
  const screenshots = 'storage/ui-workflow/organization/screenshots';
  await mkdir(screenshots, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const response = await context.request.post(
    new URL('api/auth/sign-in/username', base).href,
    { headers: { Origin: origin }, data: DEFAULT_ADMIN_CREDENTIALS },
  );
  expect(response.status()).toBe(200);
  expect(
    (await context.request.get(new URL('api/swagger', base).href)).status(),
  ).toBe(200);
  await page.goto(base);
  await expect(
    page.getByRole('heading', { level: 1, name: '集团 ERP' }),
  ).toBeVisible();
  await page.screenshot({
    path: `${screenshots}/home-zh-light.png`,
    fullPage: true,
  });
  await page.goto(new URL('organization/subjects', base).href);
  await expect(
    page.getByRole('heading', { name: '组织主体', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${screenshots}/subjects-list.png`,
    fullPage: true,
  });
  const suffix = Date.now().toString(36).toUpperCase();
  const sectorName = `验收板块${suffix}`;
  await page.goto(new URL('organization/sectors', base).href);
  await page.getByRole('button', { name: '新建业务板块', exact: true }).click();
  await page.locator('#org-name').pressSequentially(sectorName);
  await page.locator('#org-code').fill(`UI-SECTOR-${suffix}`);
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(
    page.getByRole('link', { name: sectorName, exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: `“${sectorName}”的操作` }).click();
  await page.getByRole('menuitem', { name: '停用', exact: true }).click();
  await page.locator('#status-reason').fill('键盘确认验收');
  await expect(
    page.getByRole('button', { name: '停用', exact: true }),
  ).toBeEnabled();
  await page.locator('#status-reason').press('Enter');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(
    page.getByRole('row').filter({ hasText: sectorName }),
  ).toContainText('停用');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: '新建业务板块', exact: true }).click();
  const footerButton = page.getByRole('button', { name: '创建', exact: true });
  await expect(footerButton).toBeVisible();
  await expect(footerButton).toHaveAttribute('form', 'org-record-form');
  await page.locator('#org-notes').fill('移动端滚动表单验收'.repeat(30));
  await expect(footerButton).toBeInViewport();
  await page.screenshot({
    path: `${screenshots}/sector-form-mobile-footer.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(new URL('organization/subjects', base).href);
  await page.getByRole('button', { name: '新建组织主体', exact: true }).click();
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.locator('#org-name')).toBeFocused();
  const subjectName = `验收集团${suffix}`;
  await page.locator('#org-name').pressSequentially(subjectName);
  await page.locator('#org-code').fill(`UI-GROUP-${suffix}`);
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(
    page.getByRole('link', { name: subjectName, exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: subjectName, exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('#org-shortName').fill('验收简称');
  await page.locator('#org-reason').fill('浏览器验收修改');
  await page.route('**/api/organization/subjects/*', async (route) => {
    if (route.request().method() === 'PATCH')
      await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('[data-org-back]')).toHaveAttribute('inert', '');
  await expect(page.getByText('验收简称', { exact: true })).toBeVisible();
  await page.unroute('**/api/organization/subjects/*');
  await page.reload();
  await expect(page.getByText('验收简称', { exact: true })).toBeVisible();
  await page.screenshot({
    path: `${screenshots}/subject-detail.png`,
    fullPage: true,
  });
  await page.goto(new URL('organization/subjects', base).href);
  const search = page.getByPlaceholder('搜索名称或编码');
  await search.pressSequentially('验收');
  await expect(page).toHaveURL(/q=/);
  await search.press('Home');
  await search.pressSequentially('中间');
  await search.press('ControlOrMeta+A');
  await search.dispatchEvent('compositionstart');
  await search.fill('验收集团');
  await search.dispatchEvent('compositionend', { data: '验收集团' });
  await expect(search).toHaveValue('验收集团');
  await expect(
    page.getByRole('link', { name: subjectName, exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('q'))
    .toBe('验收集团');
  await page.reload();
  await expect(search).toHaveValue('验收集团');
  await page.screenshot({
    path: `${screenshots}/subjects-filtered.png`,
    fullPage: true,
  });
  await page.goto(new URL('organization/history', base).href);
  await expect(
    page.getByText('浏览器验收修改', { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({ path: `${screenshots}/history.png`, fullPage: true });
  await page.goto(new URL('organization', base).href);
  await expect(page.getByText(subjectName, { exact: true })).toBeVisible();
  await page.screenshot({
    path: `${screenshots}/overview.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(new URL('organization/subjects/new', base).href);
  await expect(page.locator('#org-name')).toBeVisible();
  await page.screenshot({
    path: `${screenshots}/subject-form-mobile.png`,
    fullPage: true,
  });
  await page.evaluate(() =>
    localStorage.setItem('nocobase:main:theme:color-scheme', 'dark'),
  );
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('#org-name')).toBeVisible();
  await page.screenshot({
    path: `${screenshots}/subject-form-mobile-dark.png`,
    fullPage: true,
  });
  await page.evaluate(() => localStorage.setItem('nocobase.locale', 'en-US'));
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'New Organizational entities',
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: `${screenshots}/subject-form-mobile-en.png`,
    fullPage: true,
  });
  await writeFile(
    `${screenshots}/browser-results.json`,
    JSON.stringify(
      {
        pageErrors: errors,
        fixtureCodes: [`UI-SECTOR-${suffix}`, `UI-GROUP-${suffix}`],
        dataLocation: 'local development database only',
      },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
});

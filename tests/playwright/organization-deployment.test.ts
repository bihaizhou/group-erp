import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
test.use({ channel: 'chromium', viewport: { width: 1440, height: 1000 } });
test('deployed organization is reachable, secured and initially empty', async ({
  page,
  context,
  playwright,
}) => {
  test.skip(
    !process.env.ERP_PRODUCTION_URL,
    'Set ERP_PRODUCTION_URL to verify the deployed app.',
  );
  const base = process.env.ERP_PRODUCTION_URL!;
  const secret = JSON.parse(
    await readFile('deploy/initial-admin.secret.json', 'utf8'),
  ) as { username: string; password: string };
  const anonymous = await playwright.request.newContext();
  expect(
    (
      await anonymous.get(new URL('api/organization/subjects', base).href)
    ).status(),
  ).toBe(401);
  await anonymous.dispose();
  const login = await context.request.post(
    new URL('api/auth/sign-in/username', base).href,
    {
      headers: { Origin: new URL(base).origin },
      data: { username: secret.username, password: secret.password },
    },
  );
  expect(login.status()).toBe(200);
  expect(
    (await context.request.get(new URL('api/swagger', base).href)).status(),
  ).toBe(200);
  for (const kind of [
    'subjects',
    'units',
    'positions',
    'sectors',
    'relations',
  ]) {
    const result = await context.request.get(
      new URL(`api/organization/${kind}`, base).href,
    );
    expect(result.status()).toBe(200);
    expect((await result.json()).meta.total).toBe(0);
  }
  const regions = await context.request.get(
    new URL('api/organization/regions', base).href,
  );
  expect(
    (await regions.json()).data.map((row: { name: string }) => row.name).sort(),
  ).toEqual(['国内', '海外']);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await expect(
    page.getByRole('heading', { level: 1, name: '集团 ERP' }),
  ).toBeVisible();
  await page.goto(new URL('organization/subjects', base).href);
  await expect(page.getByText('尚无组织主体', { exact: true })).toBeVisible();
  await mkdir('storage/ui-workflow/organization/screenshots', {
    recursive: true,
  });
  await page.screenshot({
    path: 'storage/ui-workflow/organization/screenshots/subjects-empty-production.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '新建组织主体', exact: true }).click();
  await expect(page.locator('#org-name')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '基础信息', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(new URL('organization/sectors/new', base).href);
  await expect(page.locator('#org-name')).toBeVisible();
  await page
    .locator('#org-notes')
    .fill('只作界面预览，不保存资料。'.repeat(30));
  await expect(
    page.getByRole('button', { name: '创建', exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: 'storage/ui-workflow/organization/screenshots/sector-form-mobile-footer-production.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.goto(new URL('organization/subjects/new', base).href);
  await page.evaluate(() =>
    localStorage.setItem('nocobase:main:theme:color-scheme', 'dark'),
  );
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('#org-name')).toBeVisible();
  await page.screenshot({
    path: 'storage/ui-workflow/organization/screenshots/subject-form-mobile-dark-production.png',
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
    path: 'storage/ui-workflow/organization/screenshots/subject-form-mobile-en-production.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

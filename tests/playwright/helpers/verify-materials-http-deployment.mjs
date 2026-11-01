import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { log } from 'node:console';
import { chromium, request } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const base = 'http://192.168.5.189:13010/main/';
const directory = 'storage/deployments/materials-http-20261017-112052';
await mkdir(`${directory}/screenshots`, { recursive: true });
// Read-only business probe for the deployed patch. Never submit production forms.
const admin = JSON.parse(
  await readFile('deploy/initial-admin.secret.json', 'utf8'),
);
const api = await request.newContext({
  extraHTTPHeaders: { Origin: new URL(base).origin },
});
let browser;
try {
  const login = await api.post(`${base}api/auth/sign-in/username`, {
    data: { username: admin.username, password: admin.password },
  });
  assert.equal(login.status(), 200);
  assert.equal((await api.get(`${base}api/swagger`)).status(), 200);
  const units = await api.get(`${base}api/materials/units`);
  assert.equal(units.status(), 200);
  const unit = (await units.json()).data[0];
  browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage(),
    errors = [],
    failed = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text().slice(0, 1800));
  });
  page.on('response', (response) => {
    if (
      response.status() >= 400 &&
      new URL(response.url()).origin === new URL(base).origin
    )
      failed.push({
        status: response.status(),
        path: new URL(response.url()).pathname,
      });
  });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto(`${base}functions/warehouse/materials/templates/new`);
  const form = page.locator('#material-form');
  await form.waitFor({ state: 'visible' });
  const environment = await page.evaluate(() => ({
    secure: globalThis.isSecureContext,
    uuid: typeof globalThis.crypto.randomUUID,
    getRandomValues: typeof globalThis.crypto.getRandomValues,
  }));
  assert.equal(environment.secure, false);
  assert.equal(environment.uuid, 'undefined');
  await form.getByRole('button', { name: '添加属性', exact: true }).click();
  await form.locator('#attribute-0-key').fill('color');
  await form.locator('#attribute-0-title').fill('颜色');
  await form.getByRole('button', { name: '添加属性', exact: true }).click();
  await form.locator('#attribute-1-key').fill('size');
  await form.locator('#attribute-1-title').fill('尺寸');
  await form.getByRole('button', { name: '移除属性 1', exact: true }).click();
  assert.equal(await form.locator('#attribute-0-key').inputValue(), 'size');
  await page.screenshot({
    path: `${directory}/screenshots/template-after.png`,
    fullPage: true,
  });
  // Discard the unsaved form. No production business write is made.
  await page.goto(`${base}functions/warehouse/materials/templates/new`);
  await page.reload();
  await form.waitFor({ state: 'visible' });
  await form.getByRole('button', { name: '添加属性', exact: true }).click();
  await form.locator('#attribute-0-key').waitFor({ state: 'visible' });
  assert(unit?.id);
  await page.goto(
    `${base}functions/warehouse/materials/units/${unit.id}/actions/deactivate`,
  );
  await page.locator('#material-action-reason').waitFor({ state: 'visible' });
  await page.screenshot({
    path: `${directory}/screenshots/action-after.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  const result = {
    verifiedAt: new Date().toISOString(),
    base,
    businessWrites: 0,
    environment,
    checks: [
      'original administrator login',
      'authenticated swagger',
      'real LAN HTTP: add/remove template attributes',
      'deep link refresh',
      'material lifecycle dialog opens',
    ],
    consoleErrors: errors,
    failedResponses: failed,
  };
  await writeFile(
    `${directory}/production-verification.json`,
    JSON.stringify(result, null, 2) + '\n',
  );
  log(JSON.stringify(result));
  await context.close();
} finally {
  await browser?.close();
  await api.dispose();
}

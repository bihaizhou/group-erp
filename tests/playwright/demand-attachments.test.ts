import { randomUUID } from 'node:crypto';
/// <reference lib="dom" />
import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const dir = 'storage/ui-workflow/material-sources',
  auth = 'storage/ui-workflow/requisitions';
interface Fixture {
  base: string;
  companyId: string;
  mixedId: string;
  offered: {
    domain: string;
    id: string;
    code: string;
    lineId: string;
    taskId: string;
  }[];
}
const fixture = async () =>
  JSON.parse(await readFile(`${auth}/fixture.json`, 'utf8')) as Fixture;
test.use({
  storageState: `${auth}/auth-applicant.json`,
  viewport: { width: 1440, height: 1000 },
  actionTimeout: 15000,
});
const shot = async (page: Page, name: string) => {
  await mkdir(`${dir}/screenshots`, { recursive: true });
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
test('private attachments retain uploads after a failed save, share only a chosen line and preview real OOXML locally', async ({
  page,
}) => {
  test.setTimeout(120000);
  const f = await fixture(),
    uploaded: { id: string; filename: string; contentUrl: string }[] = [],
    external: string[] = [],
    errors: string[] = [];
  const template = await (
    await page.request.get(`${f.base}api/requisitions/requests/${f.mixedId}`)
  ).json();
  const original = template.data;
  const created = await page.request.post(
    `${f.base}api/requisitions/requests`,
    {
      headers: { Origin: new URL(f.base).origin },
      data: {
        requestKey: randomUUID(),
        content: {
          subjectId: original.subjectId,
          requesterEmployeeId: original.requesterEmployeeId,
          recipientEmployeeId: original.recipientEmployeeId,
          requestingUnitId: original.requestingUnitId,
          usage: original.usage,
          neededOn: original.neededOn,
          purposeId: original.purposeId,
          projectId: null,
          notes: original.notes,
          attachments: [],
          lines: original.lines.map((line: { selectionInput: object }) => ({
            ...line.selectionInput,
            id: randomUUID(),
          })),
        },
      },
    },
  );
  expect(created.status()).toBe(201);
  const requestId = (await created.json()).data.id as string;
  let uploads = 0,
    writes = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (
      request.url().startsWith('http') &&
      new URL(request.url()).origin !== new URL(f.base).origin
    )
      external.push(request.url());
  });
  page.on('response', (response) => {
    if (
      response.url().includes('/supplyChainFiles/uploadOne') &&
      response.status() === 201
    ) {
      uploads++;
      void response.json().then((body) => uploaded.push(body.data.record));
    }
  });
  await page.goto(
    `${f.base}functions/requisitions/requests/${requestId}/edit?subjectId=${f.companyId}`,
  );
  const form = page.locator('#issue-request-form');
  const files = [
    'sample.jpg',
    'sample.png',
    'sample.webp',
    'instructions.pdf',
    'specification.docx',
    'quantities.xlsx',
    'instructions.pptx',
  ];
  await form
    .locator('[data-demand-attachment-upload] input[type=file]')
    .setInputFiles(files.map((file) => `tests/fixtures/demand-files/${file}`));
  await expect.poll(() => uploaded.length, { timeout: 30000 }).toBe(7);
  await expect(form.locator('[data-slot=file-list] li')).toHaveCount(7);
  await expect(
    form.getByRole('button', { name: '保存', exact: true }),
  ).toBeEnabled();
  const doc = uploaded.find((file) => file.filename === 'specification.docx')!;
  await page.locator(`#attachment-line-${doc.id}`).click();
  await page.getByRole('option', { name: /明细2/u }).click();
  const share = page.getByRole('checkbox', {
    name: '提供给物料治理',
    exact: true,
    disabled: false,
  });
  await share.click();
  await expect(share).toBeChecked();
  await expect(
    page.getByRole('checkbox', {
      name: '提供给物料治理',
      exact: true,
      checked: true,
    }),
  ).toHaveCount(1);
  await form.locator('#issue-reason').pressSequentially('补充规格及数量依据');
  await page.route(
    `**/api/requisitions/requests/${requestId}`,
    async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      writes++;
      if (writes === 1)
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              status: 'INTERNAL',
              reason: 'TEMPORARY_FAILURE',
              domain: 'app',
              message: 'Opaque test detail',
            },
          }),
        });
      else await route.continue();
    },
  );
  await form.getByRole('button', { name: '保存', exact: true }).click();
  await expect(form.locator('#issue-reason')).toHaveValue('补充规格及数量依据');
  await expect(form.locator('[data-slot=file-list] li')).toHaveCount(7);
  expect(uploads).toBe(7);
  await shot(page, 'attachment-save-failure-retains-files');
  await form.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${requestId}\\?`, 'u'));
  const detail = page.locator('[data-slot=route-child-page]').last();
  await expect(detail.locator('[data-slot=file-list] li')).toHaveCount(7);
  const saved = await (
    await page.request.get(`${f.base}api/requisitions/requests/${requestId}`)
  ).json();
  expect(saved.data.attachments).toHaveLength(7);
  expect(
    saved.data.attachments.filter(
      (file: { shareWithGovernance: boolean }) => file.shareWithGovernance,
    ),
  ).toEqual([
    {
      fileId: doc.id,
      lineId: saved.data.lines[1].id,
      shareWithGovernance: true,
    },
  ]);
  await detail.locator('[data-slot=file-list]').scrollIntoViewIfNeeded();
  await shot(page, 'private-attachments-saved');
  for (const [name, format] of [
    ['specification.docx', 'docx'],
    ['quantities.xlsx', 'xlsx'],
    ['instructions.pptx', 'pptx'],
  ]) {
    await detail
      .getByRole('button', { name: `预览: ${name}`, exact: true })
      .click();
    const preview = page.getByRole('dialog', { name, exact: true });
    await expect(
      preview.locator(`[data-office-open-xml-format=${format}] canvas`).first(),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      preview.getByText('正在加载预览…', { exact: true }),
    ).toHaveCount(0);
    await shot(page, `private-${format}-preview`);
    await preview.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(preview).toHaveCount(0);
  }
  const pdf = uploaded.find((file) => file.filename === 'instructions.pdf')!;
  await detail
    .getByRole('button', { name: '预览: instructions.pdf', exact: true })
    .click();
  const pdfPreview = page.getByRole('dialog', {
    name: 'instructions.pdf',
    exact: true,
  });
  await expect(pdfPreview.locator('iframe')).toHaveAttribute('src', /^blob:/u);
  await pdfPreview.getByRole('button', { name: '关闭', exact: true }).click();
  const bytes = await page.request.get(new URL(pdf.contentUrl, f.base).href);
  expect(bytes.status()).toBe(200);
  expect(await bytes.body()).toEqual(
    await readFile('tests/fixtures/demand-files/instructions.pdf'),
  );
  expect(uploads).toBe(7);
  expect(writes).toBe(2);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  await writeFile(
    `${dir}/attachment-browser-result.json`,
    JSON.stringify(
      {
        requestId,
        uploads,
        writes,
        external,
        errors,
        formats: ['docx', 'xlsx', 'pptx'],
        pdf: 'Same-origin blob verified in headless Chromium; headed paging pending',
      },
      null,
      2,
    ),
  );
});

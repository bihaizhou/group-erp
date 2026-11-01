// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import { createStandaloneServer } from '../../server/standalone.js';
import { fixture, send, mutation } from '../helpers/purchase-requests.js';
import { supplyChainFileServiceToken } from '../../server/providers/supply-chain-files.js';
import { purchaseReadColumns } from '../../server/providers/purchase-request-resources.js';
import type { MaterialPolicies } from '../../server/providers/material-service.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    app: { publicOrigin: 'http://localhost' },
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    jobs: { default: 'memory' },
    queue: { default: 'memory' },
    logging: { console: { enabled: false }, file: { enabled: false } },
  },
});
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR6kAAAAASUVORK5CYII=',
  'base64',
);
const formats = [
  ['sample.jpg', 'image/jpeg'],
  ['sample.png', 'image/png'],
  ['sample.webp', 'image/webp'],
  ['instructions.pdf', 'application/pdf'],
  [
    'specification.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  [
    'quantities.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  [
    'instructions.pptx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
] as const;
test('private demand file uploads, metadata queries and content keep identical bytes and bind in the parent transaction', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database),
    row = await f.draft(),
    form = new FormData();
  form.set('file', new File([png], '需求.png', { type: 'image/png' }));
  const base = `/supplyChainFiles`,
    query = `?domain=procurement&requestId=${row.id}`;
  const upload = await f.applicant.session.fetch(`${base}/uploadOne${query}`, {
    method: 'POST',
    headers: { origin: 'http://localhost' },
    body: form,
  });
  const result = await upload.json();
  expect({ status: upload.status, reason: result.error?.reason }).toEqual({
    status: 201,
    reason: undefined,
  });
  const file = result.data.record;
  expect(file.contentUrl).toContain(
    `${testApp.publicBasePath}/uploads/supplyChainFiles/`,
  );
  const metadata = await send(f.applicant.session, `${base}/findOne${query}`, {
    filter: { id: file.id },
  });
  const queried = await metadata.json();
  expect(metadata.status).toBe(200);
  expect(queried.data).toMatchObject({
    id: file.id,
    filename: '需求.png',
    ext: 'png',
  });
  expect(queried.data.disk).toBeUndefined();
  expect(queried.data.key).toBeUndefined();
  const content = await testApp.fetch(
    new Request(new URL(file.contentUrl, 'http://localhost'), {
      headers: { cookie: f.applicant.session.cookie },
    }),
  );
  expect(content.status).toBe(200);
  expect(content.headers.get('Cache-Control')).toBe('private, no-store');
  expect(Buffer.from(await content.arrayBuffer())).toEqual(png);
  const anonymous = await testApp.fetch(
    new Request(new URL(file.contentUrl, 'http://localhost')),
  );
  expect(anonymous.status).toBe(401);
  const foreign = await testApp.fetch(
    new Request(new URL(file.contentUrl, 'http://localhost'), {
      headers: { cookie: f.reviewer.session.cookie },
    }),
  );
  expect(foreign.status).toBe(403);
  const input = {
    ...mutation(row),
    content: {
      ...f.content(),
      lines: row.lines.map(
        (l: { selectionInput: unknown }) => l.selectionInput,
      ),
      attachments: [
        {
          fileId: file.id,
          lineId: row.lines[0].id,
          shareWithGovernance: false,
        },
      ],
    },
  };
  const saved = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}`,
    input,
    'PATCH',
  );
  expect(saved.status).toBe(200);
  const savedRow = (await saved.json()).data;
  expect(savedRow.attachments).toEqual([
    { fileId: file.id, lineId: row.lines[0].id, shareWithGovernance: false },
  ]);
  const replay = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}`,
    input,
    'PATCH',
  );
  expect(replay.status).toBe(200);
  expect((await replay.json()).data).toEqual(savedRow);
  expect(
    await database
      .repository('supplyChainFileLinks')
      .count({ filter: { documentId: row.id } }),
  ).toBe(1);
  const after = await testApp.fetch(
    new Request(new URL(file.contentUrl, 'http://localhost'), {
      headers: { cookie: f.reviewer.session.cookie },
    }),
  );
  expect(after.status).toBe(200);
});
test('rejects disguised formats, missing parents and binding a file from a different demand', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database),
    row = await f.draft(),
    other = await f.draft(),
    body = new FormData();
  body.set(
    'file',
    new File(['pretend PNG'], 'wrong.png', { type: 'image/png' }),
  );
  const invalid = await f.applicant.session.fetch(
    `/supplyChainFiles/uploadOne?domain=procurement&requestId=${row.id}`,
    { method: 'POST', headers: { origin: 'http://localhost' }, body },
  );
  expect(invalid.status).toBe(400);
  expect((await invalid.json()).error.reason).toBe('SUPPLY_FILE_FORMAT');
  const form = new FormData();
  form.set('file', new File([png], 'valid.png', { type: 'image/png' }));
  const response = await f.applicant.session.fetch(
    `/supplyChainFiles/uploadOne?domain=procurement&requestId=${row.id}`,
    { method: 'POST', headers: { origin: 'http://localhost' }, body: form },
  );
  expect(response.status).toBe(201);
  const file = (await response.json()).data.record;
  const attempt = await send(
    f.applicant.session,
    `/procurement/requests/${other.id}`,
    {
      ...mutation(other),
      content: {
        ...f.content(),
        lines: other.lines.map(
          (l: { selectionInput: unknown }) => l.selectionInput,
        ),
        attachments: [
          { fileId: file.id, lineId: null, shareWithGovernance: false },
        ],
      },
    },
    'PATCH',
  );
  expect(attempt.status).toBe(404);
  expect(
    await database
      .repository('supplyChainFileLinks')
      .count({ filter: { documentId: other.id } }),
  ).toBe(0);
  expect(
    (await database
      .repository('purchaseRequests')
      .findOne({ filter: { id: other.id } }))!.revision,
  ).toBe(other.revision);
  expect(
    (
      await send(
        f.reviewer.session,
        `/supplyChainFiles/uploadOne?domain=procurement&requestId=invalid`,
        {},
      )
    ).status,
  ).toBe(403);
  const missing = await f.applicant.session.fetch(
    '/supplyChainFiles/uploadOne?domain=procurement',
    {
      method: 'POST',
      headers: { origin: 'http://localhost' },
      body: new FormData(),
    },
  );
  expect(missing.status).toBe(400);
});

test('all seven real formats preserve frozen references and governance reads only explicitly shared current line files', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.saveRules();
  let row = await f.draft();
  const attachments: {
      fileId: string;
      lineId: string | null;
      shareWithGovernance: boolean;
    }[] = [],
    urls: string[] = [];
  for (const [index, [name, mime]] of formats.entries()) {
    const bytes = await readFile(
        new URL(`../fixtures/demand-files/${name}`, import.meta.url),
      ),
      form = new FormData();
    form.set('file', new File([bytes], name, { type: mime }));
    const response = await f.applicant.session.fetch(
        `/supplyChainFiles/uploadOne?domain=procurement&requestId=${row.id}`,
        { method: 'POST', headers: { origin: 'http://localhost' }, body: form },
      ),
      body = await response.json();
    expect({
      name,
      status: response.status,
      reason: body.error?.reason,
    }).toEqual({ name, status: 201, reason: undefined });
    attachments.push({
      fileId: body.data.record.id,
      lineId: row.lines[0].id,
      shareWithGovernance: index >= 4,
    });
    urls.push(body.data.record.contentUrl);
  }
  const patched = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}`,
    {
      ...mutation(row),
      content: {
        ...f.content(),
        lines: row.lines.map(
          (l: { selectionInput: unknown }) => l.selectionInput,
        ),
        attachments,
      },
    },
    'PATCH',
  );
  expect(patched.status).toBe(200);
  row = (await patched.json()).data;
  row = await f.fire(row, 'submit');
  expect(row.versions[0].payload.attachments).toEqual(
    expect.arrayContaining(attachments),
  );
  expect(
    await database
      .repository('supplyChainFileLinks')
      .count({ filter: { versionId: row.submittedVersionId } }),
  ).toBe(7);
  const source = (
    await (
      await f.applicant.session.fetch(`/procurement/requests/${row.id}/sources`)
    ).json()
  ).data[0];
  expect(source.inputSnapshot.attachments.sort()).toEqual(
    attachments
      .filter((f) => f.shareWithGovernance)
      .map((f) => f.fileId)
      .sort(),
  );
  const officer = await f.person('Governance-only reader');
  const assignment = await f.authz.permissionSets.assign({
    permissionSet: 'materials-source-handler',
    subject: { type: 'user', id: officer.user.id },
  });
  expect(
    (await officer.session.fetch(`/procurement/requests/${row.id}`)).status,
  ).toBe(403);
  const metadata = await send(
      officer.session,
      `/supplyChainFiles/findMany?governanceTaskId=${source.requestId}`,
      { limit: 10 },
    ),
    body = await metadata.json();
  expect(metadata.status).toBe(200);
  expect(body.data.map((file: { id: string }) => file.id).sort()).toEqual(
    attachments
      .filter((f) => f.shareWithGovernance)
      .map((f) => f.fileId)
      .sort(),
  );
  const bytes = async (url: string) =>
    testApp.fetch(
      new Request(new URL(url, 'http://localhost'), {
        headers: { cookie: officer.session.cookie },
      }),
    );
  expect((await bytes(urls[4])).status).toBe(200);
  expect((await bytes(urls[0])).status).toBe(403);
  await f.authz.permissionSets.revoke(assignment.id);
  expect((await bytes(urls[4])).status).toBe(403);
  await f.authz.permissionSets.assign({
    permissionSet: 'materials-source-handler',
    subject: { type: 'user', id: officer.user.id },
  });
  row = await f.fire(row, 'withdraw');
  expect((await bytes(urls[4])).status).toBe(403);
  const clear = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}`,
    {
      ...mutation(row),
      content: {
        ...f.content(),
        lines: row.lines.map(
          (l: { selectionInput: unknown }) => l.selectionInput,
        ),
        attachments: [],
      },
    },
    'PATCH',
  );
  expect(clear.status).toBe(200);
  const cleared = (await clear.json()).data;
  expect(
    await database
      .repository('supplyChainFileLinks')
      .count({ filter: { documentId: row.id, versionKey: 'current' } }),
  ).toBe(0);
  expect(
    await database
      .repository('supplyChainFileLinks')
      .count({ filter: { documentId: row.id, versionId: row.versions[0].id } }),
  ).toBe(7);
  const historical = await testApp.fetch(
    new Request(new URL(urls[4], 'http://localhost'), {
      headers: { cookie: f.applicant.session.cookie },
    }),
  );
  expect(historical.status).toBe(200);
  const cancelled = await f.fire(cleared, 'cancel');
  expect(cancelled.status).toBe('cancelled');
  expect((await bytes(urls[4])).status).toBe(403);
  const cancelledHistory = await testApp.fetch(
    new Request(new URL(urls[4], 'http://localhost'), {
      headers: { cookie: f.applicant.session.cookie },
    }),
  );
  expect(cancelledHistory.status).toBe(200);
  const removed = await send(
    f.admin,
    `/supplyChainFiles/deleteOne?domain=procurement&requestId=${row.id}`,
    { filter: { id: attachments[4].fileId } },
  );
  expect(removed.status).toBe(404);
  expect(
    await database
      .repository('supplyChainFiles')
      .count({ filter: { documentId: row.id } }),
  ).toBe(7);
});

test('attachment boundaries reject empty, oversized and over-count batches and preserve the saved request on excess bindings', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  let row = await f.draft();
  const upload = async (files: File[], many = false) => {
    const body = new FormData();
    for (const file of files) body.append('file', file);
    return f.applicant.session.fetch(
      `/supplyChainFiles/upload${many ? 'Many' : 'One'}?domain=procurement&requestId=${row.id}`,
      { method: 'POST', headers: { origin: 'http://localhost' }, body },
    );
  };
  for (const [file, reason] of [
    [new File([], 'empty.png', { type: 'image/png' }), 'SUPPLY_FILE_SIZE'],
    [
      new File([Buffer.alloc(5 * 1024 * 1024 + 1)], 'large.png', {
        type: 'image/png',
      }),
      'SUPPLY_FILE_SIZE',
    ],
  ] as const) {
    const response = await upload([file]);
    expect(response.status).toBe(400);
    expect((await response.json()).error.reason).toBe(reason);
  }
  const excessive = await upload(
    Array.from(
      { length: 11 },
      (_, i) => new File([png], `count-${i}.png`, { type: 'image/png' }),
    ),
    true,
  );
  expect(excessive.status).toBe(400);
  expect((await excessive.json()).error.reason).toBe('SUPPLY_FILE_LIMIT');
  expect(
    await database
      .repository('supplyChainFiles')
      .count({ filter: { documentId: row.id } }),
  ).toBe(0);
  const exact = Buffer.alloc(5 * 1024 * 1024);
  png.copy(exact);
  const boundary = await upload([
    new File([exact], 'boundary.png', { type: 'image/png' }),
  ]);
  expect(boundary.status).toBe(201);
  const boundaryId = (await boundary.json()).data.record.id;
  const batch = await upload(
    Array.from(
      { length: 10 },
      (_, i) => new File([png], `valid-${i}.png`, { type: 'image/png' }),
    ),
    true,
  );
  expect(batch.status).toBe(201);
  const records = (await batch.json()).data.records;
  expect(records).toHaveLength(10);
  const attachments = records.map((file: { id: string }) => ({
    fileId: file.id,
    lineId: null,
    shareWithGovernance: false,
  }));
  const content = {
    ...f.content(),
    lines: row.lines.map(
      (line: { selectionInput: unknown }) => line.selectionInput,
    ),
    attachments,
  };
  const saved = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}`,
    { ...mutation(row), content },
    'PATCH',
  );
  expect(saved.status).toBe(200);
  row = (await saved.json()).data;
  const attempt = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}`,
    {
      ...mutation(row),
      content: {
        ...content,
        attachments: [
          ...attachments,
          { fileId: boundaryId, lineId: null, shareWithGovernance: false },
        ],
      },
    },
    'PATCH',
  );
  expect(attempt.status).toBe(400);
  const actual = (
    await (
      await f.applicant.session.fetch(`/procurement/requests/${row.id}`)
    ).json()
  ).data;
  expect(actual.revision).toBe(row.revision);
  expect(actual.attachments).toHaveLength(10);
});

test('line-scoped attachment edits preserve unseen references and cannot move files into or out of another line', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database),
    content = f.content();
  content.lines.push(f.line());
  let row = await f.draft(content);
  const ids: string[] = [];
  for (let index = 0; index < 3; index++) {
    const body = new FormData();
    body.set(
      'file',
      new File([png], `scope-${index}.png`, { type: 'image/png' }),
    );
    const response = await f.applicant.session.fetch(
      `/supplyChainFiles/uploadOne?domain=procurement&requestId=${row.id}`,
      { method: 'POST', headers: { origin: 'http://localhost' }, body },
    );
    expect(response.status).toBe(201);
    ids.push((await response.json()).data.record.id);
  }
  const attachments = ids.slice(0, 2).map((fileId, index) => ({
    fileId,
    lineId: row.lines[index].id as string,
    shareWithGovernance: false,
  }));
  const response = await send(
    f.applicant.session,
    `/procurement/requests/${row.id}`,
    { ...mutation(row), content: { ...content, attachments } },
    'PATCH',
  );
  expect(response.status).toBe(200);
  row = (await response.json()).data;
  const allow = {
    read: true,
    create: true,
    update: true,
    delete: false,
  } as const;
  const policies: MaterialPolicies = Object.fromEntries(
    Object.keys(purchaseReadColumns).map((table) => [table, allow]),
  );
  policies.purchaseRequestLines = {
    ...allow,
    read: {
      scope: { id: row.lines[0].id },
      fields: ['id', 'requestId', 'subjectId', 'revision', 'inputRevision'],
    },
    update: {
      scope: { id: row.lines[0].id },
      fields: ['revision', 'inputRevision'],
    },
  };
  const files = testApp.application.container.resolve(
      supplyChainFileServiceToken,
    ),
    actor = { id: f.applicant.user.id };
  const visible = await files.read(
    database.connection(),
    'purchaseRequest',
    row.id,
    undefined,
    policies,
  );
  expect(visible).toEqual([attachments[0]]);
  await database.transaction((c) =>
    files.save(c, 'purchaseRequest', row, [attachments[0]], actor, policies),
  );
  expect(
    await files.read(database.connection(), 'purchaseRequest', row.id),
  ).toEqual(expect.arrayContaining(attachments));
  for (const attempted of [
    [attachments[0], { ...attachments[1], lineId: null }],
    [attachments[0], { ...attachments[1], shareWithGovernance: true }],
    [
      attachments[0],
      { fileId: ids[2], lineId: row.lines[1].id, shareWithGovernance: false },
    ],
  ]) {
    await expect(
      database.transaction((c) =>
        files.save(c, 'purchaseRequest', row, attempted, actor, policies),
      ),
    ).rejects.toMatchObject({ reason: 'SUPPLY_FILE_FORBIDDEN' });
  }
  expect(
    await files.read(database.connection(), 'purchaseRequest', row.id),
  ).toHaveLength(2);
});

// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { createStandaloneServer } from '../../server/standalone.js';

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

test('attaches evidence files to an operations issue with company scope', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const authz = testApp.application.container.resolve(authorizationToken),
    users = testApp.application.container.resolve(
      userAdministrationServiceToken,
    );
  const makeUser = async (label: string, grants: unknown[]) => {
    const email = `${label.toLowerCase().replaceAll(' ', '-')}-${randomUUID().slice(0, 8)}@example.com`;
    const user = await users.create({
      name: label,
      email,
      password: 'Sup3r-secret!',
    });
    const key = `e2e-${randomUUID().slice(0, 12)}`;
    await authz.permissionSets.create({ key, title: label, grants });
    await authz.permissionSets.assign({
      permissionSet: key,
      subject: { type: 'user', id: user.id },
    });
    return signIn(testApp, { email, password: 'Sup3r-secret!' });
  };
  const send = async (
    client: Awaited<ReturnType<typeof signIn>>,
    path: string,
    body: unknown,
    method = 'POST',
  ) =>
    client.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
  const create = async (path: string, body: unknown) => {
    const response = await send(admin, path, body);
    expect(response.status).toBe(201);
    return (await response.json()).data;
  };
  const subject = await create('/organization/subjects', {
    code: `OPSF-${randomUUID().slice(0, 6)}`,
    name: 'Operations files company',
    type: 'group',
  });
  const issue = await create('/operations/issues', {
    subjectId: subject.id,
    sourceType: 'production',
    title: 'Evidence attachment target',
    description: 'Attach the shift report photos',
    severity: 'medium',
    ownerName: 'Line supervisor',
    dueAt: new Date().toISOString().slice(0, 10),
  });

  const manager = await makeUser('Operations manager', [
    {
      resource: { type: 'settings', id: 'operations' },
      actions: [
        { action: 'read' },
        { action: 'manage' },
        { action: 'readAll' },
      ],
    },
  ]);
  const viewer = await makeUser('Operations viewer', [
    {
      resource: { type: 'settings', id: 'operations' },
      actions: [{ action: 'read' }, { action: 'readAll' }],
    },
  ]);

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR6kAAAAASUVORK5CYII=',
    'base64',
  );
  const form = new FormData();
  form.set('file', new File([png], 'pump.png', { type: 'image/png' }));
  const upload = await manager.fetch(
    `/operationsFiles/uploadOne?issueId=${issue.id}`,
    {
      method: 'POST',
      headers: { origin: 'http://localhost' },
      body: form,
    },
  );
  expect(upload.status).toBe(201);
  const uploaded = (await upload.json()).data.record;
  expect(uploaded.contentUrl).toContain('/uploads/operationsIssueFiles/');

  const listed = await manager.fetch(
    `/operationsFiles/findMany?issueId=${issue.id}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ limit: 20 }),
    },
  );
  expect(listed.status).toBe(200);
  const rows = (await listed.json()).data;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: uploaded.id,
    filename: 'pump.png',
    ext: 'png',
  });
  expect(rows[0].disk).toBeUndefined();
  expect(rows[0].key).toBeUndefined();

  const content = await testApp.fetch(
    new Request(new URL(uploaded.contentUrl, 'http://localhost'), {
      headers: { cookie: manager.cookie },
    }),
  );
  expect(content.status).toBe(200);
  expect(content.headers.get('Cache-Control')).toBe('private, no-store');
  expect(Buffer.from(await content.arrayBuffer())).toEqual(png);

  const anonymous = await testApp.fetch(
    new Request(new URL(uploaded.contentUrl, 'http://localhost')),
  );
  expect(anonymous.status).toBe(401);

  const viewerForm = new FormData();
  viewerForm.set('file', new File([png], 'viewer.png', { type: 'image/png' }));
  const viewerUpload = await viewer.fetch(
    `/operationsFiles/uploadOne?issueId=${issue.id}`,
    {
      method: 'POST',
      headers: { origin: 'http://localhost' },
      body: viewerForm,
    },
  );
  expect(viewerUpload.status).toBe(403);

  const missing = await manager.fetch(
    `/operationsFiles/findMany?issueId=${randomUUID()}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ limit: 20 }),
    },
  );
  expect(missing.status).toBe(404);
});

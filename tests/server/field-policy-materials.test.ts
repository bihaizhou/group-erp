// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import { createStandaloneServer } from '../../server/standalone.js';
import {
  fixture as purchaseFixture,
  purchaseMaterial,
} from '../helpers/purchase-requests.js';

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
const json = (body: unknown, method = 'PUT') => ({
  method,
  headers: {
    'content-type': 'application/json',
    origin: 'http://localhost',
    'Idempotency-Key': `${Date.now()}.${randomUUID()}`,
  },
  body: JSON.stringify(body),
});

test('material SKUs redact hidden fields and reject hidden writes', async ({
  testApp,
  database,
}) => {
  const f = await purchaseFixture(testApp, database);
  const m = await purchaseMaterial(f, database);

  const key = `fp-mat-${randomUUID().slice(0, 8)}`;
  await f.authz.permissionSets.create({ key, grants: [] });
  for (const permissionSet of [key, 'materials-maintainer'])
    await f.authz.permissionSets.assign({
      permissionSet,
      subject: { type: 'user', id: f.reviewer.user.id },
    });

  const saved = await f.admin.fetch(
    '/field-policies',
    json({
      permissionSetKey: key,
      requestKey: randomUUID(),
      policies: [
        { resource: 'materials.sku', field: 'code', access: 'write' },
        { resource: 'materials.sku', field: 'name', access: 'write' },
        { resource: 'materials.sku', field: 'notes', access: 'hidden' },
        { resource: 'materials.sku', field: 'status', access: 'write' },
        { resource: 'materials.sku', field: 'managementMode', access: 'write' },
      ],
    }),
  );
  expect(saved.status).toBe(200);

  const list = await f.reviewer.session.fetch('/materials/skus');
  expect(list.status).toBe(200);
  const row = (await list.json()).data.find(
    (candidate: { id: string }) => candidate.id === m.sku.id,
  );
  expect(row).toBeTruthy();
  expect(row).not.toHaveProperty('notes');
  expect(row).toHaveProperty('name', m.sku.name);

  const detail = await f.reviewer.session.fetch(`/materials/skus/${m.sku.id}`);
  expect(detail.status).toBe(200);
  const detailBody = await detail.json();
  expect(detailBody.data).not.toHaveProperty('notes');
  expect(detailBody.data).toHaveProperty('name', m.sku.name);

  const rejected = await f.reviewer.session.fetch(
    `/materials/skus/${m.sku.id}`,
    json(
      {
        version: m.sku.version,
        name: m.sku.name,
        notes: 'Secret',
        reason: 'Isolated field policy verification',
      },
      'PATCH',
    ),
  );
  expect(rejected.status).toBe(403);
  expect(await rejected.text()).toContain('FIELD_NOT_WRITABLE');

  const allowed = await f.reviewer.session.fetch(
    `/materials/skus/${m.sku.id}`,
    json(
      {
        version: m.sku.version,
        name: 'Renamed SKU',
        reason: 'Isolated field policy verification',
      },
      'PATCH',
    ),
  );
  expect(allowed.status).toBe(200);
  expect((await allowed.json()).data).toMatchObject({ name: 'Renamed SKU' });

  const rejectedCreate = await f.reviewer.session.fetch(
    '/materials/skus',
    json(
      {
        name: 'Hidden write SKU',
        materialNameId: m.name.id,
        baseUnitId: m.each.id,
        managementMode: 'stock',
        attributeValues: { model: 'Hidden write' },
        notes: 'Secret',
      },
      'POST',
    ),
  );
  expect(rejectedCreate.status).toBe(403);
  expect(await rejectedCreate.text()).toContain('FIELD_NOT_WRITABLE');

  // A user without appFieldPolicies keeps the unchanged response shape.
  const plainKey = `fp-mat-plain-${randomUUID().slice(0, 8)}`;
  await f.authz.permissionSets.create({ key: plainKey, grants: [] });
  for (const permissionSet of [plainKey, 'materials-maintainer'])
    await f.authz.permissionSets.assign({
      permissionSet,
      subject: { type: 'user', id: f.agent.user.id },
    });
  const plainList = await f.agent.session.fetch('/materials/skus');
  expect(plainList.status).toBe(200);
  const plainRow = (await plainList.json()).data.find(
    (candidate: { id: string }) => candidate.id === m.sku.id,
  );
  expect(plainRow).toBeTruthy();
  expect(plainRow).toHaveProperty('notes');
});

test('issue requests redact hidden head and line fields and reject hidden writes', async ({
  testApp,
  database,
}) => {
  const f = await purchaseFixture(testApp, database);
  const key = `fp-req-${randomUUID().slice(0, 8)}`;
  await f.authz.permissionSets.create({ key, grants: [] });
  for (const permissionSet of [key, 'requisitions-requester'])
    await f.authz.permissionSets.assign({
      permissionSet,
      subject: { type: 'user', id: f.applicant.user.id },
    });

  const purposeResponse = await f.admin.fetch(
    '/requisitions/purposes',
    json(
      {
        content: {
          subjectId: f.a.id,
          code: 'REPAIR',
          name: '设备维修',
          description: 'Isolated field policy verification',
        },
        requestKey: randomUUID(),
      },
      'POST',
    ),
  );
  expect(purposeResponse.status).toBe(201);
  const purpose = (await purposeResponse.json()).data;

  const saved = await f.admin.fetch(
    '/field-policies',
    json({
      permissionSetKey: key,
      requestKey: randomUUID(),
      policies: [
        // The first explicit save switches the set to the ladder model:
        // every field the page sends must be granted, including the
        // contextual columns the route writes alongside the business ones.
        ...[
          'subjectId',
          'requesterEmployeeId',
          'recipientEmployeeId',
          'requestingUnitId',
          'purposeId',
          'projectId',
        ].map((field) => ({
          resource: 'issue.request',
          field,
          access: 'write' as const,
        })),
        { resource: 'issue.request', field: 'code', access: 'write' },
        { resource: 'issue.request', field: 'usage', access: 'write' },
        { resource: 'issue.request', field: 'neededOn', access: 'write' },
        { resource: 'issue.request', field: 'notes', access: 'hidden' },
        { resource: 'issue.request', field: 'status', access: 'write' },
        { resource: 'issue.request.line', field: 'lineNo', access: 'write' },
        {
          resource: 'issue.request.line',
          field: 'originalName',
          access: 'write',
        },
        {
          resource: 'issue.request.line',
          field: 'originalSpecification',
          access: 'write',
        },
        {
          resource: 'issue.request.line',
          field: 'requestedQuantity',
          access: 'write',
        },
        {
          resource: 'issue.request.line',
          field: 'requestedUnitText',
          access: 'write',
        },
        {
          resource: 'issue.request.line',
          field: 'baseQuantity',
          access: 'write',
        },
        { resource: 'issue.request.line', field: 'usage', access: 'write' },
        { resource: 'issue.request.line', field: 'notes', access: 'hidden' },
      ],
    }),
  );
  expect(saved.status).toBe(200);

  const makeLine = (id: string) => ({
    id,
    selection: {
      kind: 'unknown',
      subjectId: f.a.id,
      originalName: '原始手套',
      originalSpecification: '耐磨规格',
      requestedUnitText: '副',
      quantity: '2',
    },
    originalName: '',
    originalSpecification: '',
    usage: '',
    notes: '',
  });
  const makeContent = (
    lineId: string,
    overrides: Record<string, unknown> = {},
    lineOverrides: Record<string, unknown> = {},
  ) => ({
    subjectId: f.a.id,
    requesterEmployeeId: f.applicant.employee.id,
    recipientEmployeeId: f.applicant.employee.id,
    requestingUnitId: f.unit.id,
    purposeId: purpose.id,
    usage: 'Maintenance',
    neededOn: f.content().neededOn,
    projectId: null,
    notes: '',
    lines: [{ ...makeLine(lineId), ...lineOverrides }],
    ...overrides,
  });

  const lineId = randomUUID();
  const created = await f.applicant.session.fetch(
    '/requisitions/requests',
    json({ content: makeContent(lineId), requestKey: randomUUID() }, 'POST'),
  );
  expect(created.status).toBe(201);
  const draft = (await created.json()).data;
  expect(draft).not.toHaveProperty('notes');

  const list = await f.applicant.session.fetch(
    `/requisitions/requests?subjectId=${f.a.id}&mine=true`,
  );
  expect(list.status).toBe(200);
  const row = (await list.json()).data.find(
    (candidate: { id: string }) => candidate.id === draft.id,
  );
  expect(row).toBeTruthy();
  expect(row).not.toHaveProperty('notes');

  const detail = await f.applicant.session.fetch(
    `/requisitions/requests/${draft.id}`,
  );
  expect(detail.status).toBe(200);
  const detailBody = await detail.json();
  expect(detailBody.data).not.toHaveProperty('notes');
  expect(detailBody.data.lines[0]).not.toHaveProperty('notes');
  expect(detailBody.data.lines[0]).toHaveProperty('originalName', '原始手套');

  // A hidden head field provided on create is rejected before any write.
  const rejectedHead = await f.applicant.session.fetch(
    '/requisitions/requests',
    json(
      {
        content: makeContent(randomUUID(), { notes: 'Secret' }),
        requestKey: randomUUID(),
      },
      'POST',
    ),
  );
  expect(rejectedHead.status).toBe(403);
  expect(await rejectedHead.text()).toContain('FIELD_NOT_WRITABLE');

  // A hidden line field provided on create is rejected before any write.
  const rejectedLine = await f.applicant.session.fetch(
    '/requisitions/requests',
    json(
      {
        content: makeContent(randomUUID(), {}, { notes: 'Secret' }),
        requestKey: randomUUID(),
      },
      'POST',
    ),
  );
  expect(rejectedLine.status).toBe(403);
  expect(await rejectedLine.text()).toContain('FIELD_NOT_WRITABLE');

  const rejectedPatch = await f.applicant.session.fetch(
    `/requisitions/requests/${draft.id}`,
    json(
      {
        version: draft.revision,
        lifecycleVersion: draft.lifecycleVersion,
        requestKey: randomUUID(),
        reason: 'Isolated field policy verification',
        content: makeContent(lineId, { notes: 'Secret' }),
      },
      'PATCH',
    ),
  );
  expect(rejectedPatch.status).toBe(403);
  expect(await rejectedPatch.text()).toContain('FIELD_NOT_WRITABLE');

  const allowedPatch = await f.applicant.session.fetch(
    `/requisitions/requests/${draft.id}`,
    json(
      {
        version: draft.revision,
        lifecycleVersion: draft.lifecycleVersion,
        requestKey: randomUUID(),
        reason: 'Isolated field policy verification',
        content: makeContent(lineId, { usage: 'Maintenance updated' }),
      },
      'PATCH',
    ),
  );
  expect(allowedPatch.status).toBe(200);
  expect((await allowedPatch.json()).data).toMatchObject({
    usage: 'Maintenance updated',
  });

  // A requester without appFieldPolicies is unaffected.
  await f.authz.permissionSets.assign({
    permissionSet: 'requisitions-requester',
    subject: { type: 'user', id: f.agent.user.id },
  });
  const agentLineId = randomUUID();
  const agentCreated = await f.agent.session.fetch(
    '/requisitions/requests',
    json(
      {
        content: makeContent(agentLineId, {
          requesterEmployeeId: f.agent.employee.id,
          recipientEmployeeId: f.agent.employee.id,
        }),
        requestKey: randomUUID(),
      },
      'POST',
    ),
  );
  expect(agentCreated.status).toBe(201);
  const agentDraft = (await agentCreated.json()).data;
  const agentDetail = await f.agent.session.fetch(
    `/requisitions/requests/${agentDraft.id}`,
  );
  expect(agentDetail.status).toBe(200);
  const agentBody = await agentDetail.json();
  expect(agentBody.data).toHaveProperty('notes');
  expect(agentBody.data.lines[0]).toHaveProperty('notes');
});

// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import { databaseManagerToken } from '@nocobase/db';
import { createStandaloneServer } from '../../server/standalone.js';
import { executionFixture } from '../helpers/execution.js';
import { mutation, send } from '../helpers/purchase-requests.js';

vi.setConfig({ testTimeout: 120_000 });

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

/** Grant settings/production manage+approve to the fixture reviewer user. */
const grantProductionApprover = async (
  f: Awaited<ReturnType<typeof executionFixture>>,
) => {
  const role = await f.authz.permissionSets.create({
    key: randomUUID(),
    title: 'Production approver',
    grants: [
      {
        resource: { type: 'settings', id: 'production' },
        actions: [{ action: 'manage' }, { action: 'approve' }],
      },
    ],
  });
  await f.authz.permissionSets.assign({
    permissionSet: role.key,
    subject: { type: 'user', id: f.reviewer.user.id },
  });
};

test('runs company -> schedule -> attendance -> shift report -> inbound draft -> posting -> operations', async ({
  testApp,
}) => {
  const db = testApp.application.container.resolve(databaseManagerToken);
  const f = await executionFixture(testApp, db);
  const call = async (
    path: string,
    body: unknown,
    method = 'POST',
    session = f.admin,
  ) => {
    const response = await send(session, path, body, method);
    const payload = await response.json();
    if (response.status >= 400)
      throw new Error(
        JSON.stringify({ path, status: response.status, error: payload.error }),
      );
    return payload.data;
  };

  const ton = await db
    .repository('measureUnits')
    .findOne({ filter: { code: 'T' } });
  expect(ton).toBeTruthy();
  const sandName = await f.create('/materials/names', {
    name: `Test sand material ${randomUUID().slice(0, 6)}`,
    templateId: f.m.template.id,
  });
  let sandSku = await f.create('/materials/skus', {
    name: 'Test sand SKU',
    materialNameId: sandName.id,
    baseUnitId: String(ton!.id),
    managementMode: 'stock',
    attributeValues: { model: 'SAND' },
  });
  for (const action of ['submit', 'approve'] as const) {
    const response = await send(
      action === 'submit' ? f.admin : f.reviewer.session,
      `/materials/skus/${sandSku.id}/${action}`,
      {
        version: sandSku.lifecycleVersion,
        requestKey: randomUUID(),
        reason: 'Full-chain test SKU',
      },
    );
    expect(response.status).toBe(200);
    sandSku = (await response.json()).data;
  }
  const oreName = await f.create('/materials/names', {
    name: `Test ore material ${randomUUID().slice(0, 6)}`,
    templateId: f.m.template.id,
  });
  let oreSku = await f.create('/materials/skus', {
    name: 'Test ore SKU',
    materialNameId: oreName.id,
    baseUnitId: String(ton!.id),
    managementMode: 'stock',
    attributeValues: { model: 'ORE' },
  });
  for (const action of ['submit', 'approve'] as const) {
    const response = await send(
      action === 'submit' ? f.admin : f.reviewer.session,
      `/materials/skus/${oreSku.id}/${action}`,
      {
        version: oreSku.lifecycleVersion,
        requestKey: randomUUID(),
        reason: 'Full-chain ore SKU',
      },
    );
    expect(response.status).toBe(200);
    oreSku = (await response.json()).data;
  }
  await f.grant(f.reviewer.user.id, 'warehouse.documents', ['read', 'review']);
  await grantProductionApprover(f);
  await f.orderRules('stockDocuments');

  const position = await f.create('/organization/positions', {
    code: `PRD-${randomUUID().slice(0, 6)}`,
    name: 'Full-chain production operator',
    unitId: f.unit.id,
    productionRole: 'production',
  });
  const assignments = await db.repository('personnelAssignments').findMany({
    filter: { personId: f.applicant.employee.id },
  });
  const primary = assignments.find(
    (row) => (row.data as { type?: string })?.type === 'primary',
  );
  expect(primary).toBeTruthy();
  await db.repository('personnelAssignments').updateOne({
    filter: { id: String(primary!.id) },
    values: { positionId: position.id },
  });

  const setupBody = (
    materials: {
      role: string;
      skuId: string;
      defaultWarehouseId: string;
      notes: string;
    }[],
  ) => ({
    lineCode: 'L1',
    processType: 'crushing-screening-magnetic',
    designCapacityTpd: 100,
    commissionDate: '2020-01-01',
    region: 'test',
    status: 'active',
    materials,
  });
  const missing = await send(
    f.admin,
    `/production/setup/${f.unit.id}`,
    setupBody([
      {
        role: 'product',
        skuId: randomUUID(),
        defaultWarehouseId: f.warehouse.id,
        notes: 'unknown sku',
      },
    ]),
    'PUT',
  );
  expect(missing.status).toBe(400);
  expect(JSON.stringify(await missing.json())).toContain('SKU_NOT_FOUND');
  const duplicate = await send(
    f.admin,
    `/production/setup/${f.unit.id}`,
    setupBody([
      {
        role: 'product',
        skuId: f.m.sku.id,
        defaultWarehouseId: f.warehouse.id,
        notes: 'duplicate metal',
      },
      {
        role: 'byproduct',
        skuId: f.m.sku.id,
        defaultWarehouseId: f.warehouse.id,
        notes: 'duplicate sand',
      },
    ]),
    'PUT',
  );
  expect(duplicate.status).toBe(400);
  expect(JSON.stringify(await duplicate.json())).toContain(
    'DUPLICATE_MATERIAL',
  );
  await db.repository('materialSkus').updateOne({
    filter: { id: f.m.sku.id },
    values: { baseUnitId: String(ton!.id) },
  });
  const setup = await call(
    `/production/setup/${f.unit.id}`,
    setupBody([
      {
        role: 'feedstock',
        skuId: oreSku.id,
        notes: 'test ore',
      },
      {
        role: 'product',
        skuId: f.m.sku.id,
        defaultWarehouseId: f.warehouse.id,
        notes: 'test metal',
      },
      {
        role: 'byproduct',
        skuId: sandSku.id,
        defaultWarehouseId: f.warehouse.id,
        notes: 'test sand',
      },
    ]),
    'PUT',
  );
  expect(setup.profiles).toContainEqual(
    expect.objectContaining({ unitId: f.unit.id }),
  );
  expect(
    setup.materials.filter(
      (material: { unitId?: string }) => material.unitId === f.unit.id,
    ),
  ).toHaveLength(3);

  const workDate = '2026-10-21';
  const savedSchedule = await call(
    '/production/schedules',
    {
      unitId: f.unit.id,
      scheduleDate: workDate,
      shift: 'day',
      personIds: [f.applicant.employee.id],
      notes: 'full-chain schedule',
    },
    'PUT',
  );
  const scheduleId = savedSchedule.schedule.id as string;
  await call(`/production/schedules/${scheduleId}/publish`, {});

  const roster = await call(
    `/production/attendance?unitId=${f.unit.id}&workDate=${workDate}&shift=day`,
    undefined,
    'GET',
  );
  expect(roster).toMatchObject({ source: 'schedule', scheduleId });
  expect(roster.rows).toHaveLength(1);

  const attendance = await call(
    '/production/attendance',
    {
      unitId: f.unit.id,
      workDate,
      shift: 'day',
      records: [
        {
          personId: f.applicant.employee.id,
          positionId: position.id,
          status: 'present',
          overtimeMinutes: 60,
          overtimeContent: 'full-chain overtime',
        },
      ],
    },
    'PUT',
  );
  expect(attendance.summary).toMatchObject({ present: 1, overtimeMinutes: 60 });

  const downtimeEventId = randomUUID();
  const overtimeRequestId = randomUUID();
  const draftResponse = await call(
    '/production/report',
    {
      unitId: f.unit.id,
      reportDate: workDate,
      shift: 'day',
      report: {
        runtimeMinutes: 600,
        downtimeMinutes: 60,
        notes: 'full-chain shift report',
        materials: [
          { skuId: oreSku.id, role: 'feedstock', quantity: '100' },
          { skuId: f.m.sku.id, role: 'product', quantity: '2.5' },
          { skuId: sandSku.id, role: 'byproduct', quantity: '70' },
        ],
      },
      attendance: [],
      downtime: [
        {
          id: downtimeEventId,
          startedAt: `${workDate}T10:00:00+08:00`,
          category: 'equipment',
          impact: 'stop',
          description: 'full-chain downtime',
        },
      ],
      overtime: [
        {
          id: overtimeRequestId,
          personId: f.applicant.employee.id,
          hours: 1,
          type: 'temporary',
          reason: 'full-chain overtime approval',
          compensation: 'pay',
        },
      ],
    },
    'PUT',
  );
  let draft = draftResponse.report;

  // Overtime self-approval: the submitter (admin) cannot approve their own
  // overtime request; the granted production approver can.
  const overtimeRow = await db.repository('prdOvertimeRequests').findOne({
    filter: { id: overtimeRequestId },
  });
  expect(overtimeRow).toBeTruthy();
  const overtimeSelfApproval = await send(
    f.admin,
    `/production/overtime/${overtimeRow.id}/decision`,
    { decision: 'approve', version: Number(overtimeRow.version) },
  );
  expect(overtimeSelfApproval.status).toBe(400);
  expect(JSON.stringify(await overtimeSelfApproval.json())).toContain(
    'SELF_APPROVAL',
  );
  const overtimeApproved = await call(
    `/production/overtime/${overtimeRow.id}/decision`,
    { decision: 'approve', version: Number(overtimeRow.version) },
    'POST',
    f.reviewer.session,
  );
  expect(overtimeApproved.status).toBe('approved');

  // The recorded downtime event is closed at 45 minutes, so the
  // system-computed downtime no longer matches the manually entered 60.
  await call(`/production/downtime-events/${downtimeEventId}/close`, {
    endedAt: `${workDate}T10:45:00+08:00`,
    resolution: 'back online',
    version: 1,
  });
  const selfApproval = await send(
    f.admin,
    `/production/shift-reports/${draft.id}/confirm`,
    { version: draft.version },
  );
  expect(selfApproval.status).toBe(400);
  expect(JSON.stringify(await selfApproval.json())).toContain('SELF_APPROVAL');
  const downtimeMismatch = await send(
    f.reviewer.session,
    `/production/shift-reports/${draft.id}/confirm`,
    { version: draft.version },
  );
  expect(downtimeMismatch.status).toBe(400);
  expect(JSON.stringify(await downtimeMismatch.json())).toContain(
    'DOWNTIME_MINUTES_MISMATCH',
  );
  const realignedDraftResponse = await call(
    '/production/report',
    {
      unitId: f.unit.id,
      reportDate: workDate,
      shift: 'day',
      report: {
        version: draft.version,
        runtimeMinutes: 600,
        downtimeMinutes: 45,
        notes: 'full-chain shift report',
        materials: [
          { skuId: oreSku.id, role: 'feedstock', quantity: '100' },
          { skuId: f.m.sku.id, role: 'product', quantity: '2.5' },
          { skuId: sandSku.id, role: 'byproduct', quantity: '70' },
        ],
      },
      attendance: [],
      downtime: [
        {
          id: downtimeEventId,
          startedAt: `${workDate}T10:00:00+08:00`,
          category: 'equipment',
          impact: 'stop',
          description: 'full-chain downtime',
        },
      ],
      overtime: [],
    },
    'PUT',
  );
  draft = realignedDraftResponse.report;

  // P1-B: a cancelled downtime event keeps its recorded minutes on the row,
  // but must no longer count towards the confirm-time ΣdurationMinutes.
  const cancelledDowntimeResponse = await send(
    f.admin,
    '/production/downtime-events',
    {
      unitId: f.unit.id,
      startedAt: `${workDate}T15:00:00+08:00`,
      category: 'equipment',
      impact: 'stop',
      description: 'cancelled downtime must not count',
    },
  );
  expect(cancelledDowntimeResponse.status).toBe(201);
  const cancelledDowntime = (await cancelledDowntimeResponse.json()).data;
  // The API only cancels open events, and open events are created with 0
  // minutes, so fabricate the legacy shape — a cancelled row that keeps its
  // minutes — by writing them directly before cancelling.
  await db.repository('prdDowntimeEvents').updateOne({
    filter: { id: cancelledDowntime.id },
    values: { durationMinutes: 60 },
  });
  await call(`/production/downtime-events/${cancelledDowntime.id}/cancel`, {
    reason: 'duplicate report',
    version: cancelledDowntime.version,
  });

  // P1-A: confirm/void/reopen are gated on approve, not manage. An
  // approve-only role (no manage) must be able to confirm; a manage-only
  // role must be rejected.
  const approverOnly = await f.person(
    `Approve-only ${randomUUID().slice(0, 6)}`,
  );
  const approverOnlySet = await f.authz.permissionSets.create({
    key: randomUUID(),
    title: 'Production approve only',
    grants: [
      {
        resource: { type: 'settings', id: 'production' },
        actions: [{ action: 'approve' }],
      },
    ],
  });
  await f.authz.permissionSets.assign({
    permissionSet: approverOnlySet.key,
    subject: { type: 'user', id: approverOnly.user.id },
  });
  const manageOnly = await f.person(`Manage-only ${randomUUID().slice(0, 6)}`);
  const manageOnlySet = await f.authz.permissionSets.create({
    key: randomUUID(),
    title: 'Production manage only',
    grants: [
      {
        resource: { type: 'settings', id: 'production' },
        actions: [{ action: 'manage' }],
      },
    ],
  });
  await f.authz.permissionSets.assign({
    permissionSet: manageOnlySet.key,
    subject: { type: 'user', id: manageOnly.user.id },
  });
  const permDraftResponse = await call(
    '/production/report',
    {
      unitId: f.unit.id,
      reportDate: '2026-10-24',
      shift: 'day',
      report: {
        runtimeMinutes: 480,
        downtimeMinutes: 0,
        notes: 'permission gate check',
        materials: [{ skuId: f.m.sku.id, role: 'product', quantity: '1' }],
      },
      attendance: [],
      downtime: [],
      overtime: [],
    },
    'PUT',
  );
  const permDraft = permDraftResponse.report;
  const manageOnlyConfirm = await send(
    manageOnly.session,
    `/production/shift-reports/${permDraft.id}/confirm`,
    { version: permDraft.version },
  );
  expect(manageOnlyConfirm.status).toBe(403);
  expect(JSON.stringify(await manageOnlyConfirm.json())).toContain(
    'PERMISSION_DENIED',
  );
  const approverOnlyConfirm = await send(
    approverOnly.session,
    `/production/shift-reports/${permDraft.id}/confirm`,
    { version: permDraft.version },
  );
  expect(approverOnlyConfirm.status).toBe(200);
  expect((await approverOnlyConfirm.json()).data.status).toBe('confirmed');

  const now = new Date().toISOString();
  const issueRequestId = randomUUID();
  const issueLineId = randomUUID();
  const issueDocumentId = randomUUID();
  const issueStockLineId = randomUUID();
  await db.repository('materialIssueRequests').createOne({
    values: {
      id: issueRequestId,
      code: `ISSUE-${randomUUID().slice(0, 8)}`,
      subjectId: f.a.id,
      requesterEmployeeId: f.applicant.employee.id,
      recipientEmployeeId: f.applicant.employee.id,
      recipientAccountId: f.applicant.user.id,
      requesterAccountId: f.applicant.user.id,
      requestingUnitId: f.unit.id,
      usage: 'full-chain input',
      neededOn: workDate,
      notes: '',
      status: 'approved',
      statusChangedAt: now,
      lifecycleVersion: 1,
      revision: 1,
      contentVersion: 1,
      governanceEpoch: 1,
      reviewRound: 0,
      identifiedCount: 1,
      identificationStatus: 'identified',
      lineCount: 1,
      parameterContract: 1,
      createdBy: f.applicant.user.id,
      updatedBy: f.applicant.user.id,
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.repository('materialIssueRequestLines').createOne({
    values: {
      id: issueLineId,
      requestId: issueRequestId,
      subjectId: f.a.id,
      lineNo: 1,
      status: 'approved',
      revision: 1,
      inputRevision: 1,
      governanceAttempt: 0,
      originalName: 'Full-chain input',
      originalSpecification: '',
      requestedQuantity: '10',
      requestedUnitText: 'each',
      requestedUnitId: f.m.each.id,
      materialNameId: f.m.name.id,
      skuId: f.m.sku.id,
      skuRevision: 1,
      managementModeSnapshot: 'stock',
      unitId: f.m.each.id,
      numeratorSnapshot: '1',
      denominatorSnapshot: '1',
      baseUnitId: f.m.each.id,
      baseQuantity: '10',
      identificationStatus: 'identified',
      materialSnapshot: { code: f.m.sku.code, name: f.m.sku.name },
      confirmedBy: f.applicant.user.id,
      confirmedAt: now,
      usage: 'full-chain input',
      notes: '',
      selectionInput: {},
    },
  });
  await db.repository('stockDocuments').createOne({
    values: {
      id: issueDocumentId,
      code: `ISSUE-DOC-${randomUUID().slice(0, 8)}`,
      subjectId: f.a.id,
      warehouseId: f.warehouse.id,
      kind: 'issue',
      issueRequestId,
      status: 'posted',
      revision: 1,
      lifecycleVersion: 1,
      statusChangedAt: now,
      occurredOn: workDate,
      reason: 'full-chain issue input',
      notes: '',
      createdBy: f.applicant.user.id,
      updatedBy: f.applicant.user.id,
      createdAt: now,
      updatedAt: now,
      postedBy: f.applicant.user.id,
      postedAt: now,
    },
  });
  await db.repository('stockDocumentLines').createOne({
    values: {
      id: issueStockLineId,
      documentId: issueDocumentId,
      subjectId: f.a.id,
      lineNo: 1,
      revision: 1,
      status: 'active',
      skuId: f.m.sku.id,
      baseUnitId: f.m.each.id,
      unitId: f.m.each.id,
      issueRequestId,
      issueRequestLineId: issueLineId,
      quantity: '2',
      baseQuantity: '2',
      numeratorSnapshot: '1',
      denominatorSnapshot: '1',
      quality: 'qualified',
      materialSnapshot: { code: f.m.sku.code, name: f.m.sku.name },
      notes: '',
    },
  });
  const missingReason = await send(
    f.admin,
    `/production/shift-reports/${draft.id}/inputs`,
    {
      version: draft.version,
      sourceType: 'manual',
      skuId: f.m.sku.id,
      quantity: '2',
      note: '',
    },
  );
  expect(missingReason.status).toBe(400);
  const withManualInput = await call(
    `/production/shift-reports/${draft.id}/inputs`,
    {
      version: draft.version,
      sourceType: 'manual',
      skuId: f.m.sku.id,
      quantity: '2',
      note: 'full-chain manual input',
    },
  );
  const excessiveIssue = await send(
    f.admin,
    `/production/shift-reports/${draft.id}/inputs`,
    {
      version: withManualInput.version,
      sourceType: 'issue',
      skuId: f.m.sku.id,
      quantity: '20',
      note: '',
      issueRequestId,
      issueRequestLineId: issueLineId,
      stockDocumentId: issueDocumentId,
      stockDocumentLineId: issueStockLineId,
    },
  );
  expect(excessiveIssue.status).toBe(400);
  const withIssueInput = await call(
    `/production/shift-reports/${draft.id}/inputs`,
    {
      version: withManualInput.version,
      sourceType: 'issue',
      skuId: f.m.sku.id,
      quantity: '2',
      note: '',
      issueRequestId,
      issueRequestLineId: issueLineId,
      stockDocumentId: issueDocumentId,
      stockDocumentLineId: issueStockLineId,
    },
  );
  expect(withIssueInput.inputs).toHaveLength(2);
  const manualInput = withIssueInput.inputs.find(
    (input: { sourceType: string }) => input.sourceType === 'manual',
  );
  const issueInput = withIssueInput.inputs.find(
    (input: { sourceType: string }) => input.sourceType === 'issue',
  );
  expect(manualInput).toBeTruthy();
  expect(issueInput).toBeTruthy();
  const afterManualRemove = await call(
    `/production/shift-reports/${draft.id}/inputs/${manualInput.id}`,
    { version: withIssueInput.version },
    'DELETE',
  );
  expect(afterManualRemove.inputs).toHaveLength(1);
  const afterManualReadd = await call(
    `/production/shift-reports/${draft.id}/inputs`,
    {
      version: afterManualRemove.version,
      sourceType: 'manual',
      skuId: f.m.sku.id,
      quantity: '2',
      note: 'full-chain manual input restored',
    },
  );
  expect(afterManualReadd.inputs).toHaveLength(2);
  const linkedDelete = await send(
    f.admin,
    `/production/shift-reports/${draft.id}/inputs/${issueInput.id}`,
    { version: afterManualReadd.version },
    'DELETE',
  );
  expect(linkedDelete.status).toBe(409);
  const confirmed = await call(
    `/production/shift-reports/${draft.id}/confirm`,
    {
      version: afterManualReadd.version,
    },
    'POST',
    f.reviewer.session,
  );
  expect(confirmed.status).toBe('confirmed');
  expect(confirmed.outputs).toHaveLength(2);

  const inbound = await call(
    `/production/shift-reports/${draft.id}/inbound`,
    {},
  );
  const documentId = inbound.outputs?.[0]?.stockDocumentId as
    string | undefined;
  expect(documentId).toBeTruthy();
  expect(
    inbound.outputs.every(
      (output: { stockDocumentId?: string }) =>
        output.stockDocumentId === documentId,
    ),
  ).toBe(true);

  // A retried request must return the same receipt instead of creating a
  // second draft for the same report revision.
  const retriedInbound = await call(
    `/production/shift-reports/${draft.id}/inbound`,
    {},
  );
  expect(
    retriedInbound.outputs.every(
      (output: { stockDocumentId?: string }) =>
        output.stockDocumentId === documentId,
    ),
  ).toBe(true);

  const document = await call(
    `/warehouse/documents/${documentId}`,
    undefined,
    'GET',
  );
  expect(document).toMatchObject({
    kind: 'productionReceipt',
    status: 'draft',
  });
  await call(`/warehouse/documents/${documentId}/submit`, mutation(document));
  const submitted = await call(
    `/warehouse/documents/${documentId}`,
    undefined,
    'GET',
  );
  expect(submitted).toMatchObject({ status: 'pending' });
  await call(
    `/warehouse/documents/${documentId}/approve`,
    mutation(submitted),
    'POST',
    f.reviewer.session,
  );
  const approved = await call(
    `/warehouse/documents/${documentId}`,
    undefined,
    'GET',
  );
  expect(approved).toMatchObject({ status: 'approved' });
  const posted = await call(
    `/warehouse/documents/${documentId}/post`,
    mutation(approved),
  );
  expect(posted).toMatchObject({ status: 'posted' });

  // Correction path: a confirmed report can be voided before any active
  // receipt exists, reopened, corrected and confirmed again.
  const nightEventId = randomUUID();
  const correctionDraftResponse = await call(
    '/production/report',
    {
      unitId: f.unit.id,
      reportDate: '2026-10-20',
      shift: 'night',
      report: {
        runtimeMinutes: 540,
        downtimeMinutes: 60,
        notes: 'correction before inbound',
        materials: [
          { skuId: f.m.sku.id, role: 'product', quantity: '2' },
          { skuId: sandSku.id, role: 'byproduct', quantity: '60' },
        ],
      },
      attendance: [],
      downtime: [
        {
          id: nightEventId,
          startedAt: '2026-10-20T22:00:00+08:00',
          category: 'equipment',
          impact: 'stop',
          description: 'night downtime',
        },
      ],
      overtime: [],
    },
    'PUT',
  );
  const correctionDraft = correctionDraftResponse.report;
  await call(`/production/downtime-events/${nightEventId}/close`, {
    endedAt: '2026-10-20T23:00:00+08:00',
    resolution: 'resolved',
    version: 1,
  });
  const correctionConfirmed = await call(
    `/production/shift-reports/${correctionDraft.id}/confirm`,
    { version: correctionDraft.version },
    'POST',
    f.reviewer.session,
  );
  expect(correctionConfirmed.status).toBe('confirmed');
  const voided = await call(
    `/production/shift-reports/${correctionDraft.id}/void`,
    {
      version: correctionConfirmed.version,
      reason: 'scale reading corrected',
    },
  );
  expect(voided.status).toBe('void');
  expect(voided.outputs).toHaveLength(0);
  expect(voided.correctionHistory).toHaveLength(1);
  const reopened = await call(
    `/production/shift-reports/${correctionDraft.id}/reopen`,
    { version: voided.version },
  );
  expect(reopened.status).toBe('draft');
  const correctedResponse = await call(
    '/production/report',
    {
      unitId: f.unit.id,
      reportDate: '2026-10-20',
      shift: 'night',
      report: {
        version: reopened.version,
        runtimeMinutes: 540,
        downtimeMinutes: 60,
        notes: 'corrected before inbound',
        materials: [
          { skuId: f.m.sku.id, role: 'product', quantity: '2.1' },
          { skuId: sandSku.id, role: 'byproduct', quantity: '61' },
        ],
      },
      attendance: [],
      downtime: [
        {
          id: nightEventId,
          startedAt: '2026-10-20T22:00:00+08:00',
          category: 'equipment',
          impact: 'stop',
          description: 'night downtime',
        },
      ],
      overtime: [],
    },
    'PUT',
  );
  const corrected = correctedResponse.report;
  const reconfirmed = await call(
    `/production/shift-reports/${correctionDraft.id}/confirm`,
    { version: corrected.version },
    'POST',
    f.reviewer.session,
  );
  expect(reconfirmed.outputs).toContainEqual(
    expect.objectContaining({ outputType: 'metal', quantity: '2.1' }),
  );

  const blockedVoid = await send(
    f.admin,
    `/production/shift-reports/${draft.id}/void`,
    { version: inbound.version, reason: 'posted receipt must block void' },
  );
  expect(blockedVoid.status).toBe(409);
  expect(JSON.stringify(await blockedVoid.json())).toContain('INBOUND_ACTIVE');

  // Cumulative issue-line check: the same issued line may not be referenced
  // beyond its issued base quantity across all active shift reports (the
  // confirmed day report already claims '2' of the issued '2').
  const overIssueDraftResponse = await call(
    '/production/report',
    {
      unitId: f.unit.id,
      reportDate: '2026-10-23',
      shift: 'day',
      report: {
        runtimeMinutes: 480,
        downtimeMinutes: 0,
        notes: 'over-issue check',
        materials: [{ skuId: f.m.sku.id, role: 'product', quantity: '1' }],
      },
      attendance: [],
      downtime: [],
      overtime: [],
    },
    'PUT',
  );
  const overIssueDraft = overIssueDraftResponse.report;
  const withOverIssueInput = await call(
    `/production/shift-reports/${overIssueDraft.id}/inputs`,
    {
      version: overIssueDraft.version,
      sourceType: 'issue',
      skuId: f.m.sku.id,
      quantity: '2',
      note: '',
      issueRequestId,
      issueRequestLineId: issueLineId,
      stockDocumentId: issueDocumentId,
      stockDocumentLineId: issueStockLineId,
    },
  );
  const overIssued = await send(
    f.reviewer.session,
    `/production/shift-reports/${overIssueDraft.id}/confirm`,
    { version: withOverIssueInput.version },
  );
  expect(overIssued.status).toBe(400);
  expect(JSON.stringify(await overIssued.json())).toContain(
    'INPUT_LINE_OVER_ISSUED',
  );

  const metalBalance = await db.repository('stockBalances').findOne({
    filter: {
      warehouseId: String(f.warehouse.id),
      skuId: f.m.sku.id,
      quality: 'qualified',
    },
  });
  const sandBalance = await db.repository('stockBalances').findOne({
    filter: {
      warehouseId: String(f.warehouse.id),
      skuId: sandSku.id,
      quality: 'qualified',
    },
  });
  expect(Number(metalBalance?.quantity)).toBeCloseTo(2.5, 6);
  expect(Number(sandBalance?.quantity)).toBeCloseTo(70, 6);

  const overview = await call(
    `/operations/overview?subjectId=${f.a.id}&date=${workDate}`,
    undefined,
    'GET',
  );
  expect(overview.production).toMatchObject({
    reports: 1,
    processed: '100',
    metal: '2.5',
    sand: '70',
  });
  expect(overview.warehouse).toMatchObject({
    receiptPosted: 1,
    stockConfigured: true,
  });
  expect(Number(overview.warehouse.stockMetal)).toBeCloseTo(2.5, 6);
  expect(Number(overview.warehouse.stockSand)).toBeCloseTo(70, 6);

  // P2: once the issue posting is reversed, its lines no longer reserve the
  // issued base quantity, so the same draft can be confirmed. The reversal
  // posting's reversesPostingId is the authoritative "already reversed" flag.
  const reversalNow = new Date().toISOString();
  const issuePostingId = randomUUID();
  await db.repository('stockPostings').createOne({
    values: {
      id: issuePostingId,
      documentId: issueDocumentId,
      subjectId: f.a.id,
      reversesPostingId: null,
      fingerprint: randomUUID(),
      actorId: f.applicant.user.id,
      reason: 'full-chain issue posting',
      createdAt: reversalNow,
    },
  });
  const reversalDocumentId = randomUUID();
  await db.repository('stockDocuments').createOne({
    values: {
      id: reversalDocumentId,
      code: `REVERSAL-${randomUUID().slice(0, 8)}`,
      subjectId: f.a.id,
      warehouseId: f.warehouse.id,
      kind: 'reversal',
      originalDocumentId: issueDocumentId,
      originalPostingId: issuePostingId,
      status: 'posted',
      revision: 1,
      lifecycleVersion: 1,
      statusChangedAt: reversalNow,
      occurredOn: '2026-10-23',
      reason: 'Reverse the issued line before reconfirming the report',
      notes: '',
      createdBy: f.admin.user.id,
      updatedBy: f.admin.user.id,
      createdAt: reversalNow,
      updatedAt: reversalNow,
    },
  });
  await db.repository('stockPostings').createOne({
    values: {
      id: randomUUID(),
      documentId: reversalDocumentId,
      subjectId: f.a.id,
      reversesPostingId: issuePostingId,
      fingerprint: randomUUID(),
      actorId: f.admin.user.id,
      reason: 'Reversed issue line test',
      createdAt: reversalNow,
    },
  });
  const reversedLineConfirmed = await call(
    `/production/shift-reports/${overIssueDraft.id}/confirm`,
    { version: withOverIssueInput.version },
    'POST',
    f.reviewer.session,
  );
  expect(reversedLineConfirmed.status).toBe('confirmed');

  // P2: legacy reports only have hand-entered downtime minutes and no
  // prdDowntimeEvents rows for that day; there is nothing to compare against,
  // so confirmation must not raise DOWNTIME_MINUTES_MISMATCH.
  const legacyDowntimeResponse = await call(
    '/production/report',
    {
      unitId: f.unit.id,
      reportDate: '2026-10-25',
      shift: 'day',
      report: {
        runtimeMinutes: 480,
        downtimeMinutes: 30,
        notes: 'legacy downtime without events',
        materials: [{ skuId: f.m.sku.id, role: 'product', quantity: '1' }],
      },
      attendance: [],
      downtime: [],
      overtime: [],
    },
    'PUT',
  );
  const legacyDowntime = legacyDowntimeResponse.report;
  const legacyConfirmed = await call(
    `/production/shift-reports/${legacyDowntime.id}/confirm`,
    { version: legacyDowntime.version },
    'POST',
    f.reviewer.session,
  );
  expect(legacyConfirmed.status).toBe('confirmed');
});

test('allows two product SKUs with explicit output types (metal + sand) and keeps metal totals clean', async ({
  testApp,
}) => {
  const db = testApp.application.container.resolve(databaseManagerToken);
  const f = await executionFixture(testApp, db);
  await grantProductionApprover(f);
  const call = async (
    path: string,
    body: unknown,
    method = 'POST',
    session = f.admin,
  ) => {
    const response = await send(session, path, body, method);
    const payload = await response.json();
    if (response.status >= 400)
      throw new Error(
        JSON.stringify({ path, status: response.status, error: payload.error }),
      );
    return payload.data;
  };

  const ton = await db
    .repository('measureUnits')
    .findOne({ filter: { code: 'T' } });
  expect(ton).toBeTruthy();
  const sandName = await f.create('/materials/names', {
    name: `Test dual-output sand ${randomUUID().slice(0, 6)}`,
    templateId: f.m.template.id,
  });
  let sandSku = await f.create('/materials/skus', {
    name: 'Test dual-output sand SKU',
    materialNameId: sandName.id,
    baseUnitId: String(ton!.id),
    managementMode: 'stock',
    attributeValues: { model: 'SAND' },
  });
  for (const action of ['submit', 'approve'] as const) {
    const response = await send(
      action === 'submit' ? f.admin : f.reviewer.session,
      `/materials/skus/${sandSku.id}/${action}`,
      {
        version: sandSku.lifecycleVersion,
        requestKey: randomUUID(),
        reason: 'Dual-output test SKU',
      },
    );
    expect(response.status).toBe(200);
    sandSku = (await response.json()).data;
  }

  const setupBody = (
    materials: {
      role: string;
      skuId: string;
      outputType?: string | null;
      defaultWarehouseId: string;
      notes: string;
    }[],
  ) => ({
    lineCode: 'L2',
    processType: 'crushing-screening-magnetic',
    designCapacityTpd: 100,
    commissionDate: '2020-01-01',
    region: 'test',
    status: 'active',
    materials,
  });

  // Two product rows that resolve to the same output type must be rejected.
  const clashing = await send(
    f.admin,
    `/production/setup/${f.unit.id}`,
    setupBody([
      {
        role: 'product',
        skuId: f.m.sku.id,
        outputType: 'metal',
        defaultWarehouseId: f.warehouse.id,
        notes: 'metal A',
      },
      {
        role: 'product',
        skuId: sandSku.id,
        outputType: 'metal',
        defaultWarehouseId: f.warehouse.id,
        notes: 'metal B clash',
      },
    ]),
    'PUT',
  );
  expect(clashing.status).toBe(400);
  expect(JSON.stringify(await clashing.json())).toContain(
    'OUTPUT_TYPE_DUPLICATE',
  );

  // Distinct output types: metal + sand both as product rows.
  const setup = await call(
    `/production/setup/${f.unit.id}`,
    setupBody([
      {
        role: 'product',
        skuId: f.m.sku.id,
        outputType: 'metal',
        defaultWarehouseId: f.warehouse.id,
        notes: 'dual metal',
      },
      {
        role: 'product',
        skuId: sandSku.id,
        outputType: 'sand',
        defaultWarehouseId: f.warehouse.id,
        notes: 'dual sand',
      },
    ]),
    'PUT',
  );
  const outputTypeBySku = new Map(
    setup.materials.map((material: { skuId: string; outputType: string }) => [
      material.skuId,
      material.outputType,
    ]),
  );
  expect(outputTypeBySku.get(f.m.sku.id)).toBe('metal');
  expect(outputTypeBySku.get(sandSku.id)).toBe('sand');

  const mappings = await db.repository('prdOutputMappings').findMany({
    filter: { unitId: f.unit.id },
    limit: 50,
  });
  expect(mappings).toHaveLength(2);

  const workDate = '2026-10-22';
  const draftResponse = await call(
    '/production/report',
    {
      unitId: f.unit.id,
      reportDate: workDate,
      shift: 'day',
      report: {
        runtimeMinutes: 600,
        downtimeMinutes: 0,
        notes: 'dual output report',
        materials: [
          { skuId: f.m.sku.id, role: 'product', quantity: '2' },
          { skuId: sandSku.id, role: 'product', quantity: '50' },
        ],
      },
      attendance: [],
      downtime: [],
      overtime: [],
    },
    'PUT',
  );
  const draft = draftResponse.report;

  const confirmed = await call(
    `/production/shift-reports/${draft.id}/confirm`,
    { version: draft.version },
    'POST',
    f.reviewer.session,
  );
  expect(confirmed.outputs).toHaveLength(2);
  expect(
    new Set(
      confirmed.outputs.map(
        (output: { outputType: string }) => output.outputType,
      ),
    ),
  ).toEqual(new Set(['metal', 'sand']));

  const reportRow = await db.repository('prdShiftReports').findOne({
    filter: { id: draft.id },
  });
  const rowValues = (reportRow?.data ?? {}) as Record<string, unknown>;
  expect(rowValues.metalQuantity ?? reportRow?.metalQuantity).toBe('2');
  expect(rowValues.sandQuantity ?? reportRow?.sandQuantity).toBe('50');
});

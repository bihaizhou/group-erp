// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { databaseManagerToken } from '@nocobase/db';
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

test('builds a production roster from HR positions and records attendance', async ({
  testApp,
  request,
}) => {
  expect((await request('/production/options')).status).toBe(401);
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const send = async (path: string, body: unknown, method = 'POST') =>
    admin.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
  const create = async (path: string, body: unknown) => {
    const response = await send(path, body);
    const payload = await response.json();
    expect(response.status).toBe(201);
    return payload.data;
  };
  const subject = await create('/organization/subjects', {
    code: `PRD-${randomUUID().slice(0, 6)}`,
    name: 'Production test company',
    type: 'group',
  });
  const unit = await create('/organization/units', {
    code: `PRD-U-${randomUUID().slice(0, 6)}`,
    name: 'Production test line',
    type: 'department',
    subjectId: subject.id,
  });
  const position = await create('/organization/positions', {
    code: `PRD-P-${randomUUID().slice(0, 6)}`,
    name: 'Magnetic separator operator',
    unitId: unit.id,
    productionRole: 'production',
  });
  const personId = randomUUID();
  const now = new Date().toISOString();
  const db = testApp.application.container.resolve(databaseManagerToken);
  await db.repository('personnelEmployees').createOne({
    values: {
      id: personId,
      code: `PRD-E-${randomUUID().slice(0, 6)}`,
      name: 'Zhang San',
      status: 'active',
      lifecycleVersion: 0,
      createdBy: 'test',
      data: {},
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.repository('personnelAssignments').createOne({
    values: {
      id: randomUUID(),
      code: `PRD-A-${randomUUID().slice(0, 6)}`,
      name: 'Operator assignment',
      status: 'active',
      lifecycleVersion: 0,
      createdBy: 'test',
      data: { type: 'primary', startDate: '2020-01-01' },
      createdAt: now,
      updatedAt: now,
      subjectId: subject.id,
      personId,
      positionId: position.id,
    },
  });

  const options = await admin.fetch('/production/options');
  expect(options.status).toBe(200);
  expect((await options.json()).data.units).toContainEqual({
    id: unit.id,
    name: 'Production test line',
    subjectId: subject.id,
  });

  const workDate = '2026-10-21';
  const initial = await admin.fetch(
    `/production/attendance?unitId=${unit.id}&workDate=${workDate}&shift=day`,
  );
  expect(initial.status).toBe(200);
  const roster = (await initial.json()).data;
  expect(roster.rows).toHaveLength(1);
  expect(roster.rows[0]).toMatchObject({
    personId,
    personName: 'Zhang San',
    positionId: position.id,
    status: 'unrecorded',
  });

  const missingContent = await send(
    '/production/attendance',
    {
      unitId: unit.id,
      workDate,
      shift: 'day',
      records: [
        {
          personId,
          positionId: position.id,
          status: 'present',
          overtimeMinutes: 60,
          overtimeContent: '',
        },
      ],
    },
    'PUT',
  );
  expect(missingContent.status).toBe(400);
  expect(await missingContent.text()).toContain('OVERTIME_CONTENT_REQUIRED');

  const saved = await send(
    '/production/attendance',
    {
      unitId: unit.id,
      workDate,
      shift: 'day',
      records: [
        {
          personId,
          positionId: position.id,
          status: 'present',
          overtimeMinutes: 120,
          overtimeContent: 'Cleared a jam',
        },
      ],
    },
    'PUT',
  );
  expect(saved.status).toBe(200);
  const savedRoster = (await saved.json()).data;
  expect(savedRoster.summary).toMatchObject({
    expected: 1,
    present: 1,
    unrecorded: 0,
    overtimePeople: 1,
    overtimeMinutes: 120,
  });
  expect(savedRoster.rows[0]).toMatchObject({
    status: 'present',
    overtimeMinutes: 120,
    overtimeContent: 'Cleared a jam',
  });

  const setup = await admin.fetch('/production/setup');
  expect(setup.status).toBe(200);
  expect((await setup.json()).data.units).toContainEqual(
    expect.objectContaining({ id: unit.id }),
  );
  const savedSetup = await send(
    `/production/setup/${unit.id}`,
    {
      lineCode: 'L1',
      processType: 'crushing-screening-magnetic',
      designCapacityTpd: 800,
      commissionDate: '2024-06-01',
      region: 'North',
      status: 'active',
      materials: [],
    },
    'PUT',
  );
  expect(savedSetup.status).toBe(200);
  expect((await savedSetup.json()).data.profiles).toContainEqual(
    expect.objectContaining({
      unitId: unit.id,
      lineCode: 'L1',
      designCapacityTpd: 800,
    }),
  );

  const invalidOutput = await send(
    `/production/setup/${unit.id}`,
    {
      status: 'active',
      materials: [
        {
          role: 'product',
          skuId: randomUUID(),
        },
      ],
    },
    'PUT',
  );
  expect(invalidOutput.status).toBe(400);
  expect(await invalidOutput.text()).toContain('SKU_NOT_FOUND');

  const draftResponse = await send('/production/shift-reports', {
    unitId: unit.id,
    reportDate: '2026-10-20',
    shift: 'day',
    processedQuantity: '100',
    metalQuantity: '2.5',
    sandQuantity: '70',
    tailingsQuantity: '27.5',
    runtimeMinutes: 600,
    downtimeMinutes: 60,
    notes: 'First shift',
  });
  expect(draftResponse.status).toBe(200);
  const draft = (await draftResponse.json()).data;
  expect(draft).toMatchObject({
    unitId: unit.id,
    reportDate: '2026-10-20',
    shift: 'day',
    status: 'draft',
    processedQuantity: '100',
    metalQuantity: '2.5',
  });

  const listed = await admin.fetch(
    `/production/shift-reports?unitId=${unit.id}&reportDate=2026-10-20`,
  );
  expect(listed.status).toBe(200);
  expect((await listed.json()).data.data).toContainEqual(
    expect.objectContaining({ id: draft.id, status: 'draft' }),
  );

  const missingMapping = await send(
    `/production/shift-reports/${draft.id}/confirm`,
    { version: draft.version },
  );
  expect(missingMapping.status).toBe(400);
  expect(await missingMapping.text()).toContain('OUTPUT_REQUIRED');

  const schedule = await admin.fetch(
    `/production/schedules?unitId=${unit.id}&scheduleDate=${workDate}&shift=day`,
  );
  expect(schedule.status).toBe(200);
  const schedulePayload = (await schedule.json()).data;
  expect(schedulePayload.schedule).toBeNull();
  expect(schedulePayload.people).toContainEqual(
    expect.objectContaining({ personId, assigned: false }),
  );

  const invalidSchedule = await send(
    '/production/schedules',
    {
      unitId: unit.id,
      scheduleDate: workDate,
      shift: 'day',
      personIds: [randomUUID()],
    },
    'PUT',
  );
  expect(invalidSchedule.status).toBe(400);
  expect(await invalidSchedule.text()).toContain('SCHEDULE_PERSON_NOT_IN_UNIT');

  const savedSchedule = await send(
    '/production/schedules',
    {
      unitId: unit.id,
      scheduleDate: workDate,
      shift: 'day',
      personIds: [personId],
      notes: 'Day shift roster',
    },
    'PUT',
  );
  expect(savedSchedule.status).toBe(200);
  const savedSchedulePayload = (await savedSchedule.json()).data;
  expect(savedSchedulePayload.schedule).toMatchObject({
    unitId: unit.id,
    scheduleDate: workDate,
    shift: 'day',
    status: 'draft',
  });
  expect(savedSchedulePayload.summary).toMatchObject({
    planned: 1,
    assigned: 1,
  });

  const beforePublish = await admin.fetch(
    `/production/attendance?unitId=${unit.id}&workDate=${workDate}&shift=day`,
  );
  expect((await beforePublish.json()).data.source).toBe('positions');

  const published = await send(
    `/production/schedules/${savedSchedulePayload.schedule.id}/publish`,
    {},
  );
  expect(published.status).toBe(200);
  expect((await published.json()).data.status).toBe('published');

  const afterPublish = await admin.fetch(
    `/production/attendance?unitId=${unit.id}&workDate=${workDate}&shift=day`,
  );
  const scheduledRoster = (await afterPublish.json()).data;
  expect(scheduledRoster.source).toBe('schedule');
  expect(scheduledRoster.scheduleId).toBe(savedSchedulePayload.schedule.id);
  expect(scheduledRoster.rows).toHaveLength(1);
  const equipmentResponse = await send('/production/equipment', {
    unitId: unit.id,
    code: 'EQ-001',
    name: 'Magnetic separator',
    category: 'separation',
    criticality: 'high',
  });
  expect(equipmentResponse.status).toBe(200);
  const equipment = (await equipmentResponse.json()).data;
  expect(equipment).toMatchObject({
    unitId: unit.id,
    code: 'EQ-001',
    status: 'active',
  });

  const duplicateEquipment = await send('/production/equipment', {
    unitId: unit.id,
    code: 'EQ-001',
    name: 'Duplicate',
  });
  expect(duplicateEquipment.status).toBe(409);

  const orderResponse = await send('/production/maintenance-orders', {
    unitId: unit.id,
    equipmentId: equipment.id,
    type: 'repair',
    priority: 'high',
    description: 'Bearing noise',
    assigneeName: 'Li Si',
  });
  expect(orderResponse.status).toBe(200);
  const order = (await orderResponse.json()).data;
  expect(order).toMatchObject({
    equipmentId: equipment.id,
    status: 'reported',
    priority: 'high',
  });

  const started = await send(
    `/production/maintenance-orders/${order.id}`,
    { status: 'in_progress', version: order.version },
    'PATCH',
  );
  expect(started.status).toBe(200);
  const startedOrder = (await started.json()).data;
  expect(startedOrder).toMatchObject({ status: 'in_progress' });
  expect(startedOrder.startedAt).toBeTruthy();

  const missingSolution = await send(
    `/production/maintenance-orders/${order.id}`,
    { status: 'completed', version: startedOrder.version },
    'PATCH',
  );
  expect(missingSolution.status).toBe(400);
  expect(await missingSolution.text()).toContain(
    'MAINTENANCE_SOLUTION_REQUIRED',
  );

  const completed = await send(
    `/production/maintenance-orders/${order.id}`,
    {
      status: 'completed',
      version: startedOrder.version,
      solution: 'Replaced bearing',
      downtimeMinutes: 90,
    },
    'PATCH',
  );
  expect(completed.status).toBe(200);
  expect((await completed.json()).data).toMatchObject({
    status: 'completed',
    solution: 'Replaced bearing',
    downtimeMinutes: 90,
  });

  const equipmentAfter = await admin.fetch(
    `/production/equipment?unitId=${unit.id}`,
  );
  expect((await equipmentAfter.json()).data.equipment).toContainEqual(
    expect.objectContaining({ id: equipment.id, status: 'active' }),
  );

  const planResponse = await send('/production/maintenance-plans', {
    unitId: unit.id,
    equipmentId: equipment.id,
    name: 'Monthly inspection',
    type: 'inspection',
    intervalDays: 30,
    nextDueOn: '2026-10-01',
    checklist: 'Check oil and vibration',
  });
  expect(planResponse.status).toBe(200);
  const plan = (await planResponse.json()).data;
  expect(plan).toMatchObject({
    equipmentId: equipment.id,
    status: 'active',
    dueStatus: 'overdue',
    openOrderId: null,
  });

  const generated = await send(
    `/production/maintenance-plans/${plan.id}/generate`,
    {},
  );
  expect(generated.status).toBe(200);
  const generatedOrder = (await generated.json()).data;
  expect(generatedOrder).toMatchObject({
    planId: plan.id,
    equipmentId: equipment.id,
    status: 'reported',
    type: 'inspection',
    existing: false,
  });

  const generatedAgain = await send(
    `/production/maintenance-plans/${plan.id}/generate`,
    {},
  );
  expect(generatedAgain.status).toBe(200);
  expect((await generatedAgain.json()).data).toMatchObject({
    id: generatedOrder.id,
    existing: true,
  });

  const startedPlanOrder = await send(
    `/production/maintenance-orders/${generatedOrder.id}`,
    { status: 'in_progress', version: generatedOrder.version },
    'PATCH',
  );
  expect(startedPlanOrder.status).toBe(200);
  const startedPlanOrderData = (await startedPlanOrder.json()).data;
  const generatedWhileInProgress = await send(
    `/production/maintenance-plans/${plan.id}/generate`,
    {},
  );
  expect(generatedWhileInProgress.status).toBe(200);
  expect((await generatedWhileInProgress.json()).data).toMatchObject({
    id: generatedOrder.id,
    existing: true,
    status: 'in_progress',
  });
  const completedPlanOrder = await send(
    `/production/maintenance-orders/${generatedOrder.id}`,
    {
      status: 'completed',
      version: startedPlanOrderData.version,
      solution: 'Inspected and lubricated',
    },
    'PATCH',
  );
  expect(completedPlanOrder.status).toBe(200);

  const plansAfter = await admin.fetch(
    `/production/maintenance-plans?unitId=${unit.id}`,
  );
  const planAfter = (await plansAfter.json()).data.plans.find(
    (row: { id: string }) => row.id === plan.id,
  );
  expect(planAfter).toMatchObject({
    status: 'active',
    openOrderId: null,
  });
  expect(planAfter.lastCompletedOn).toBeTruthy();
  expect(planAfter.nextDueOn).not.toBe('2026-10-01');

  const candidates = await admin.fetch(
    `/production/overtime/candidates?unitId=${unit.id}&businessDate=${workDate}`,
  );
  expect(candidates.status).toBe(200);
  expect((await candidates.json()).data.people).toContainEqual(
    expect.objectContaining({ personId }),
  );

  const overtimeResponse = await send('/production/overtime', {
    unitId: unit.id,
    personId,
    businessDate: workDate,
    hours: 2.5,
    type: 'temporary',
    reason: 'Night shift repair',
    compensation: 'time_off',
  });
  expect(overtimeResponse.status).toBe(200);
  const overtime = (await overtimeResponse.json()).data;
  expect(overtime).toMatchObject({
    personId,
    businessDate: workDate,
    hours: '2.50',
    status: 'submitted',
    compensation: 'time_off',
  });

  const overtimeList = await admin.fetch(
    `/production/overtime?unitId=${unit.id}&businessDate=${workDate}`,
  );
  expect(overtimeList.status).toBe(200);
  expect((await overtimeList.json()).data.records).toContainEqual(
    expect.objectContaining({ id: overtime.id, personId }),
  );

  const approvedOvertime = await send(
    `/production/overtime/${overtime.id}/decision`,
    { decision: 'approve', version: overtime.version },
  );
  expect(approvedOvertime.status).toBe(200);
  expect((await approvedOvertime.json()).data).toMatchObject({
    status: 'approved',
  });

  const rejectCandidate = await send('/production/overtime', {
    unitId: unit.id,
    personId,
    businessDate: workDate,
    hours: 1,
    type: 'planned',
    reason: 'Planned maintenance',
    compensation: 'none',
  });
  expect(rejectCandidate.status).toBe(200);
  const rejectOvertime = (await rejectCandidate.json()).data;
  const missingRejectReason = await send(
    `/production/overtime/${rejectOvertime.id}/decision`,
    { decision: 'reject', version: rejectOvertime.version },
  );
  expect(missingRejectReason.status).toBe(400);
  expect(await missingRejectReason.text()).toContain('REJECT_REASON_REQUIRED');
  const rejectedOvertime = await send(
    `/production/overtime/${rejectOvertime.id}/decision`,
    {
      decision: 'reject',
      version: rejectOvertime.version,
      reason: 'Not enough workload',
    },
  );
  expect(rejectedOvertime.status).toBe(200);
  expect((await rejectedOvertime.json()).data).toMatchObject({
    status: 'rejected',
    rejectReason: 'Not enough workload',
  });

  const downtimeStarted = '2026-10-21T01:00:00.000Z';
  const downtimeResponse = await send('/production/downtime-events', {
    unitId: unit.id,
    equipmentId: equipment.id,
    startedAt: downtimeStarted,
    category: 'equipment',
    impact: 'stop',
    description: 'Crusher jam',
  });
  expect(downtimeResponse.status).toBe(201);
  const downtime = (await downtimeResponse.json()).data;
  expect(downtime).toMatchObject({
    status: 'open',
    equipmentId: equipment.id,
    category: 'equipment',
    durationMinutes: 0,
  });

  const downtimeList = await admin.fetch(
    `/production/downtime-events?unitId=${unit.id}&date=2026-10-21`,
  );
  expect(downtimeList.status).toBe(200);
  expect((await downtimeList.json()).data.events).toContainEqual(
    expect.objectContaining({ id: downtime.id, description: 'Crusher jam' }),
  );

  const closedDowntime = await send(
    `/production/downtime-events/${downtime.id}/close`,
    {
      endedAt: '2026-10-21T03:00:00.000Z',
      resolution: 'Cleared the jam and replaced the screen',
      version: downtime.version,
    },
  );
  expect(closedDowntime.status).toBe(200);
  expect((await closedDowntime.json()).data).toMatchObject({
    status: 'closed',
    durationMinutes: 120,
    resolution: 'Cleared the jam and replaced the screen',
  });

  const cancelledDowntimeResponse = await send('/production/downtime-events', {
    unitId: unit.id,
    startedAt: '2026-10-21T04:00:00.000Z',
    category: 'other',
    impact: 'other',
    description: 'Duplicate report',
  });
  const cancelledDowntime = (await cancelledDowntimeResponse.json()).data;
  const cancelled = await send(
    `/production/downtime-events/${cancelledDowntime.id}/cancel`,
    { reason: 'Duplicate', version: cancelledDowntime.version },
  );
  expect(cancelled.status).toBe(200);
  expect((await cancelled.json()).data).toMatchObject({ status: 'cancelled' });

  const invalidDowntime = await send('/production/downtime-events', {
    unitId: unit.id,
    startedAt: '2026-10-21T05:00:00.000Z',
    category: 'other',
    impact: 'stop',
    description: 'Invalid end',
  });
  const invalidDowntimeData = (await invalidDowntime.json()).data;
  const invalidClose = await send(
    `/production/downtime-events/${invalidDowntimeData.id}/close`,
    {
      endedAt: '2026-10-21T04:00:00.000Z',
      resolution: 'Invalid',
      version: invalidDowntimeData.version,
    },
  );
  expect(invalidClose.status).toBe(400);
  expect(await invalidClose.text()).toContain('END_BEFORE_START');
});

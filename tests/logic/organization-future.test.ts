// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { createStandaloneServer } from '../../server/standalone.js';
import { businessDate } from '../../server/providers/business-date.js';
import { organizationServiceToken } from '../../server/providers/organization.js';

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

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

test('queues future organization changes, applies them on time, and handles cancellation and failure', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const send = async (path: string, body: unknown, method = 'POST') =>
    admin.fetch(`/organization/${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
  const create = async (kind: string, body: unknown) => {
    const response = await send(kind, body);
    const payload = await response.json();
    expect(response.status).toBe(201);
    return payload.data;
  };
  const errorOf = async (response: Awaited<ReturnType<typeof admin.fetch>>) =>
    (await response.json()).error as { reason: string };
  const readRecord = async (kind: string, id: string) => {
    const response = await admin.fetch(`/organization/${kind}/${id}`);
    expect(response.status).toBe(200);
    return (await response.json()).data;
  };
  const pendingOf = async (kind: string, recordId: string) => {
    const response = await admin.fetch(
      `/organization/pending?kind=${kind}&recordId=${recordId}`,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as {
      rows: Array<{
        id: string;
        status: string;
        errorReason: string | null;
        appliedAt: string | null;
      }>;
      total: number;
    };
  };
  const service = testApp.application.container.resolve(
    organizationServiceToken,
  );
  const today = businessDate('Asia/Shanghai');
  const future = shiftDate(today, 2);

  const suffix = randomUUID().slice(0, 8);
  const sector = await create('sectors', {
    name: `Future sector ${suffix}`,
    code: `FUT-SEC-${suffix}`,
  });
  const group = await create('subjects', {
    name: `Future group ${suffix}`,
    code: `FUT-GRP-${suffix}`,
    type: 'group',
  });
  const company = await create('subjects', {
    name: `Future company ${suffix}`,
    code: `FUT-CO-${suffix}`,
    type: 'company',
    parentId: group.id,
    sectorId: sector.id,
    regionId: '00000000-0000-4000-8000-000000000001',
  });
  const unit = await create('units', {
    name: `Future unit ${suffix}`,
    code: `FUT-UNIT-${suffix}`,
    type: 'department',
    subjectId: company.id,
  });
  const spare = await create('units', {
    name: `Future spare ${suffix}`,
    code: `FUT-SPARE-${suffix}`,
    type: 'department',
    subjectId: company.id,
  });

  // Saving without an effective date keeps the immediate write path.
  const immediate = await send(
    `units/${unit.id}`,
    {
      name: `Future unit immediate ${suffix}`,
      version: unit.version,
      reason: 'Immediate rename',
    },
    'PATCH',
  );
  expect(immediate.status).toBe(200);
  const immediateRecord = (await immediate.json()).data;
  expect(immediateRecord.name).toBe(`Future unit immediate ${suffix}`);
  expect(immediateRecord.version).toBe(unit.version + 1);

  // Today and the past must be saved directly, not queued.
  for (const invalidDate of [today, shiftDate(today, -1)]) {
    const invalid = await send(`units/${unit.id}/schedule`, {
      version: immediateRecord.version,
      reason: 'Invalid effective date',
      effectiveFrom: invalidDate,
      changes: { name: `Rejected ${suffix}` },
    });
    expect(invalid.status).toBe(400);
    expect((await errorOf(invalid)).reason).toBe('ORG_INVALID_EFFECTIVE_DATE');
  }

  // A stale revision is refused before anything is queued.
  const conflicted = await send(`units/${unit.id}/schedule`, {
    version: immediateRecord.version + 7,
    reason: 'Stale version',
    effectiveFrom: future,
    changes: { name: `Stale ${suffix}` },
  });
  expect(conflicted.status).toBe(409);
  expect((await errorOf(conflicted)).reason).toBe('ORG_VERSION_CONFLICT');
  expect((await pendingOf('units', unit.id)).total).toBe(0);

  // Scheduling a future rename stores the change without touching the record.
  const scheduled = await send(`units/${unit.id}/schedule`, {
    version: immediateRecord.version,
    reason: 'Future rename',
    effectiveFrom: future,
    changes: { name: `Future unit scheduled ${suffix}` },
  });
  expect(scheduled.status).toBe(201);
  const pending = (await scheduled.json()).data;
  expect(pending.status).toBe('pending');
  expect(pending.effectiveFrom).toBe(future);
  expect(pending.operation).toBe('update');
  expect(pending.actorName).toBeTruthy();

  const unchanged = await readRecord('units', unit.id);
  expect(unchanged.name).toBe(`Future unit immediate ${suffix}`);
  expect(unchanged.version).toBe(immediateRecord.version);

  const listed = await pendingOf('units', unit.id);
  expect(listed.total).toBe(1);
  expect(listed.rows).toHaveLength(1);
  expect(listed.rows[0].id).toBe(pending.id);

  // The manual sweep is the same operation the 30s timer runs.
  expect(await service.applyDue(future)).toEqual([]);
  const applied = await readRecord('units', unit.id);
  expect(applied.name).toBe(`Future unit scheduled ${suffix}`);
  expect(applied.version).toBe(immediateRecord.version + 1);
  const appliedPending = await pendingOf('units', unit.id);
  expect(appliedPending.rows[0].status).toBe('applied');
  expect(appliedPending.rows[0].appliedAt).toBeTruthy();

  const history = await admin.fetch(
    `/organization/history?kind=units&recordId=${unit.id}&pageSize=100`,
  );
  expect(history.status).toBe(200);
  const operations = (await history.json()).data.map(
    (row: { operation: string }) => row.operation,
  );
  expect(operations).toContain('update');
  expect(operations).toContain('applySchedule');

  // A scheduled enable/disable applies through the same sweep.
  const disable = await send(`units/${spare.id}/schedule`, {
    version: spare.version,
    reason: 'Future deactivation',
    effectiveFrom: future,
    changes: { status: 'inactive', name: `Future spare renamed ${suffix}` },
  });
  expect(disable.status).toBe(201);
  expect((await disable.json()).data.operation).toBe('disable');
  expect(await service.applyDue(future)).toEqual([]);
  const disabled = await readRecord('units', spare.id);
  expect(disabled.status).toBe('inactive');
  expect(disabled.name).toBe(`Future spare renamed ${suffix}`);
  expect(disabled.version).toBe(spare.version + 1);

  // A cancelled change never reaches the record.
  const toCancel = await send(`units/${unit.id}/schedule`, {
    version: applied.version,
    reason: 'Cancelled rename',
    effectiveFrom: future,
    changes: { name: `Future unit cancelled ${suffix}` },
  });
  expect(toCancel.status).toBe(201);
  const cancelledId = (await toCancel.json()).data.id;
  const cancel = await admin.fetch(
    `/organization/pending/${cancelledId}/cancel`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ reason: 'No longer needed' }),
    },
  );
  expect(cancel.status).toBe(200);
  expect((await cancel.json()).data.status).toBe('cancelled');
  expect((await service.applyDue(future)).length).toBe(0);
  expect((await readRecord('units', unit.id)).name).toBe(
    `Future unit scheduled ${suffix}`,
  );
  const afterCancel = await pendingOf('units', unit.id);
  expect(afterCancel.rows.find((row) => row.id === cancelledId)!.status).toBe(
    'cancelled',
  );

  const cancelAgain = await admin.fetch(
    `/organization/pending/${cancelledId}/cancel`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ reason: 'Again' }),
    },
  );
  expect(cancelAgain.status).toBe(409);
  expect((await errorOf(cancelAgain)).reason).toBe('ORG_PENDING_STATE');
  const cancelMissing = await admin.fetch(
    `/organization/pending/${randomUUID()}/cancel`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ reason: 'Missing' }),
    },
  );
  expect(cancelMissing.status).toBe(404);
  expect((await errorOf(cancelMissing)).reason).toBe('ORG_PENDING_NOT_FOUND');

  // A change that fails validation is marked failed and does not block others.
  const failing = await send(`subjects/${company.id}/schedule`, {
    version: company.version,
    reason: 'Deactivate while a unit is active',
    effectiveFrom: future,
    changes: { status: 'inactive' },
  });
  expect(failing.status).toBe(201);
  const failingId = (await failing.json()).data.id;
  const failures = await service.applyDue(future);
  expect(failures).toHaveLength(1);
  expect(failures[0].id).toBe(failingId);
  expect(failures[0].reason).toBe('ORG_ACTIVE_DEPENDENTS');
  const failedPending = await pendingOf('subjects', company.id);
  expect(failedPending.rows[0].status).toBe('failed');
  expect(failedPending.rows[0].errorReason).toBe('ORG_ACTIVE_DEPENDENTS');
  expect((await readRecord('subjects', company.id)).status).toBe('active');
});

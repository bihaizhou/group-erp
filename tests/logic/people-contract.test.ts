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

type Row = { id: string; lifecycleVersion: number; status: string };
const day = (offset: number) => {
  const date = new Date(`${businessDate()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

test('reminds on contracts that end soon and records a new end date', async ({
  testApp,
  database,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const send = (path: string, body: unknown, method = 'POST') =>
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
    if (response.status !== 201)
      throw new Error(
        `CREATE ${path} ${response.status} ${JSON.stringify(payload)}`,
      );
    return payload.data;
  };
  const fire = async (row: Row, transition: string) => {
    const response = await send(`/people/changes/${row.id}/fire`, {
      transition,
      version: row.lifecycleVersion,
      requestId: randomUUID(),
      reason: `Contract test ${transition}`,
    });
    const payload = await response.json();
    if (response.status !== 200)
      throw new Error(
        `FIRE ${transition} ${response.status} ${JSON.stringify(payload)}`,
      );
    return payload.data as Row;
  };

  const subject = await create('/organization/subjects', {
    code: 'CT-GROUP',
    name: 'Contract group',
    type: 'group',
  });
  const unit = await create('/organization/units', {
    code: 'CT-UNIT',
    name: 'Contract unit',
    type: 'department',
    subjectId: subject.id,
  });
  const position = await create('/organization/positions', {
    code: 'CT-JOB',
    name: 'Contract engineer',
    unitId: unit.id,
  });
  const employee = await create('/people/employees', {
    code: 'CT-E-1',
    name: 'Contract employee',
    subjectId: subject.id,
    data: {},
  });
  const change = await create('/people/changes', {
    code: 'CT-ENTRY-1',
    name: 'Entry',
    personId: employee.id,
    data: {
      type: 'entry',
      effectiveDate: businessDate(),
      targetSubjectId: subject.id,
      targetPositionId: position.id,
      contractEnd: day(30),
      explanation: 'Contract test',
    },
  });
  await fire(await fire(change, 'submit'), 'approve');

  const employment = await database
    .repository('personnelEmployments')
    .findOne({ filter: { personId: employee.id } });
  expect(employment?.data).toMatchObject({ contractEnd: day(30) });

  const expiries = async (days: number) => {
    const response = await admin.fetch(
      `/people/contract-expiries?days=${days}`,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as {
      data: { id: string; contractEnd: string; daysLeft: number }[];
      meta: { total: number };
    };
  };
  const soon = await expiries(90);
  expect(soon.meta.total).toBe(1);
  expect(soon.data[0]).toMatchObject({
    id: employment!.id,
    contractEnd: day(30),
    daysLeft: 30,
  });
  expect((await expiries(10)).meta.total).toBe(0);

  const listed = (await (await admin.fetch('/people/employments')).json()) as {
    data: { id: string; version: number }[];
  };
  const row = listed.data.find((item) => item.id === employment!.id)!;
  const update = await send(
    `/people/employments/${employment!.id}/contract-end`,
    {
      contractEnd: day(200),
      reason: 'Renewed for one year',
      version: row.version,
    },
  );
  expect(update.status).toBe(200);
  expect(
    ((await update.json()) as { data: { data: { contractEnd: string } } }).data
      .data.contractEnd,
  ).toBe(day(200));
  expect((await expiries(90)).meta.total).toBe(0);

  const invalid = await send(
    `/people/employments/${employment!.id}/contract-end`,
    {
      contractEnd: day(-1),
      reason: 'Backdated contract',
      version: row.version + 1,
    },
  );
  expect(invalid.status).toBe(400);
  expect(
    ((await invalid.json()) as { error: { reason: string } }).error.reason,
  ).toBe('PEOPLE_DATE_CONFLICT');

  const audit = await database.repository('peopleAudit').findOne({
    filter: {
      kind: 'employments',
      recordId: employment!.id,
      operation: 'contract',
    },
  });
  expect(audit?.reason).toBe('Renewed for one year');
});

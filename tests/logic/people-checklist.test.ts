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

type Change = { id: string; lifecycleVersion: number; status: string };
type Checklist = {
  total: number;
  done: number;
  items: { id: string; key: string; done: boolean; note: string }[];
};

test('starts and tracks the change handout checklist', async ({ testApp }) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const request = (path: string, method = 'GET', body?: unknown) =>
    admin.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const create = async (path: string, body: unknown) => {
    const response = await request(path, 'POST', body),
      payload = await response.json();
    if (response.status !== 201)
      throw new Error(
        `CREATE ${path} ${response.status} ${JSON.stringify(payload)}`,
      );
    return payload.data;
  };
  const detail = async (id: string) => {
    const response = await request(`/people/changes/${id}`),
      payload = await response.json();
    expect(response.status).toBe(200);
    return payload.data as Change & {
      checklist: Checklist;
      data: Record<string, unknown>;
    };
  };
  const fire = async (row: Change, transition: string) => {
    const response = await request(`/people/changes/${row.id}/fire`, 'POST', {
      transition,
      version: row.lifecycleVersion,
      requestId: randomUUID(),
      reason: `Checklist test ${transition}`,
    });
    const payload = await response.json();
    if (response.status !== 200)
      throw new Error(
        `FIRE ${transition} ${response.status} ${JSON.stringify(payload)}`,
      );
    return payload.data as Change;
  };
  const subject = await create('/organization/subjects', {
    code: 'CL-GROUP',
    name: 'Checklist group',
    type: 'group',
  });
  const unit = await create('/organization/units', {
    code: 'CL-UNIT',
    name: 'Checklist unit',
    type: 'department',
    subjectId: subject.id,
  });
  const position = await create('/organization/positions', {
    code: 'CL-JOB',
    name: 'Checklist role',
    unitId: unit.id,
  });
  const employee = await create('/people/employees', {
    code: 'CL-001',
    name: 'Checklist person',
    subjectId: subject.id,
    data: {},
  });
  // Blank optional dates used to fail request validation with a generic
  // "invalid value"; the API now normalizes them to null.
  const created = await create('/people/changes', {
    code: 'CL-RZ-001',
    name: 'Entry',
    personId: employee.id,
    data: {
      type: 'entry',
      effectiveDate: businessDate(),
      targetSubjectId: subject.id,
      targetPositionId: position.id,
      probationEnd: '',
      contractEnd: '',
      explanation: 'Checklist entry',
    },
  });
  expect(created.data.probationEnd).toBeNull();
  expect(created.data.contractEnd).toBeNull();
  const draft = await detail(created.id);
  expect(draft.checklist.total).toBe(0);
  await fire(created, 'submit');
  let change = await detail(created.id);
  expect(change.checklist.total).toBe(4);
  expect(change.checklist.done).toBe(0);
  expect(change.checklist.items.map((item) => item.key)).toEqual([
    'entry-pickup',
    'entry-accounts',
    'entry-onboarding',
    'entry-contract',
  ]);
  const tick = async (
    itemId: string,
    body: { done: boolean; note?: string },
  ) => {
    const response = await request(
      `/people/changes/${created.id}/checklist/${itemId}`,
      'POST',
      body,
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    return payload.data as Checklist;
  };
  let checklist = await tick(change.checklist.items[0].id, {
    done: true,
    note: 'Laptop and badge handed out',
  });
  expect(checklist.done).toBe(1);
  expect(checklist.items[0].note).toBe('Laptop and badge handed out');
  checklist = await tick(change.checklist.items[1].id, { done: true });
  expect(checklist.done).toBe(2);
  checklist = await tick(change.checklist.items[0].id, { done: false });
  expect(checklist.done).toBe(1);
  // Returning and resubmitting keeps the same checklist instead of duplicating it.
  await fire(change, 'return');
  change = await detail(created.id);
  expect(change.status).toBe('draft');
  await fire(change, 'submit');
  change = await detail(created.id);
  expect(change.checklist.total).toBe(4);
  expect(change.checklist.done).toBe(1);
  // An item from another change is not addressable.
  const missing = await request(
    `/people/changes/${created.id}/checklist/${randomUUID()}`,
    'POST',
    { done: true },
  );
  expect(missing.status).toBe(404);
});

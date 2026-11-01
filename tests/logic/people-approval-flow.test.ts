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

type Client = Awaited<ReturnType<typeof signIn>>;
type Row = { id: string; lifecycleVersion: number; status: string };
type Approval = {
  round: number;
  status: string;
  currentStage: number | null;
  stages: {
    stageIndex: number;
    status: string;
    mode: string;
    candidates: { id: string; name: string }[];
    decisions: { actorId: string; decision: string; reason: string }[];
  }[];
};

test('runs a two-stage approval, then all-signed stages, return and withdraw', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const send = (client: Client, path: string, body: unknown, method = 'POST') =>
    client.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
  const create = async (path: string, body: unknown) => {
    const r = await send(admin, path, body);
    const p = await r.json();
    expect(r.status).toBe(201);
    return p.data;
  };
  const decide = async (
    client: Client,
    row: Row,
    transition: string,
    reason = 'Test decision',
  ) => {
    const r = await send(client, `/people/changes/${row.id}/fire`, {
      transition,
      version: row.lifecycleVersion,
      requestId: randomUUID(),
      reason,
    });
    const p = await r.json();
    return { status: r.status, data: p.data, error: p.error };
  };
  const subject = await create('/organization/subjects', {
    code: 'OA-GROUP',
    name: 'OA group',
    type: 'group',
  });
  const unit = await create('/organization/units', {
    code: 'OA-UNIT',
    name: 'OA unit',
    type: 'department',
    subjectId: subject.id,
  });
  const position = await create('/organization/positions', {
    code: 'OA-JOB',
    name: 'OA engineer',
    unitId: unit.id,
  });
  let sequence = 0;
  const entry = async () => {
    sequence += 1;
    // Every entry hires a fresh employee so applying it cannot conflict.
    const employee = await create('/people/employees', {
      code: `OA-E-${sequence}`,
      name: `OA employee ${sequence}`,
      subjectId: subject.id,
      data: {},
    });
    return create('/people/changes', {
      code: `OA-ENTRY-${sequence}`,
      name: 'Entry',
      personId: employee.id,
      data: {
        type: 'entry',
        effectiveDate: businessDate(),
        targetSubjectId: subject.id,
        targetPositionId: position.id,
        explanation: 'OA test',
      },
    });
  };
  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const authz = testApp.application.container.resolve(authorizationToken);
  const account = async (name: string, permissionSet: string) => {
    const password = randomUUID(),
      email = `oa-${randomUUID()}@example.test`;
    const user = await users.create({ name, email, password });
    await authz.permissionSets.assign({
      permissionSet,
      subject: { type: 'user', id: user.id },
    });
    return { user, client: await signIn(testApp, { email, password }) };
  };
  const reviewer = await account('Reviewer A', 'personnel-reviewer'),
    signer = await account('Reviewer B', 'personnel-reader');

  const settingsResponse = await admin.fetch('/people/approval-settings');
  const settingsBody = await settingsResponse.json();
  if (settingsResponse.status !== 200)
    throw new Error(
      `SETTINGS ${settingsResponse.status} ${JSON.stringify(settingsBody)}`,
    );
  const settings = settingsBody.data as {
    revision: number;
    values: { approvalChains: Record<string, { stages: unknown[] }> };
  };
  const chains = settings.values.approvalChains;
  let revision = settings.revision;
  const save = async (entryChain: unknown) => {
    const response = await send(
      admin,
      '/people/approval-settings',
      {
        values: {
          approvalChains: { ...chains, entry: { stages: entryChain } },
        },
        version: revision,
        requestId: randomUUID(),
      },
      'PUT',
    );
    const body = await response.json();
    if (response.status === 200) revision = body.data.revision;
    return { status: response.status, body };
  };
  const stages = (mode: 'any' | 'all') => [
    {
      key: 'hr',
      title: '人事复核',
      mode,
      selections: [
        { type: 'role', referenceId: 'personnel-reviewer' },
        { type: 'user', referenceId: signer.user.id },
      ],
      subjectIds: [],
    },
    {
      key: 'leader',
      title: '负责人确认',
      mode: 'any',
      selections: [{ type: 'user', referenceId: signer.user.id }],
      subjectIds: [],
    },
  ];
  const firstSave = await save(stages('any'));
  if (firstSave.status !== 200)
    throw new Error(
      `SAVE ${firstSave.status} ${JSON.stringify(firstSave.body)}`,
    );
  expect(firstSave.status).toBe(200);

  const change = await entry();
  const submitted = await decide(admin, change, 'submit');
  expect(submitted.status).toBe(200);
  expect(submitted.data.status).toBe('pending');
  const detail = (
    await (await admin.fetch(`/people/changes/${change.id}`)).json()
  ).data;
  let approval = detail.approval as Approval;
  expect(approval.stages).toHaveLength(2);
  expect(approval.stages[0].status).toBe('pending');
  expect(approval.stages[1].status).toBe('waiting');
  expect(approval.currentStage).toBe(0);

  // The applicant created the change and is never a candidate.
  expect((await decide(admin, detail, 'approve')).status).toBe(403);

  const stage1 = await decide(reviewer.client, detail, 'approve');
  expect(stage1.status).toBe(200);
  approval = stage1.data.approval as Approval;
  expect(approval.stages[0].status).toBe('approved');
  expect(approval.stages[0].decisions[0].decision).toBe('approve');
  expect(approval.stages[1].status).toBe('pending');
  expect((await decide(reviewer.client, stage1.data, 'approve')).status).toBe(
    403,
  );

  const final = await decide(signer.client, stage1.data, 'approve');
  expect(final.status).toBe(200);
  expect(final.data.status).toBe('effective');

  // Return sends the change back to draft and closes the round.
  expect((await save(stages('any'))).status).toBe(200);
  const returnedChange = await entry();
  const second = await decide(admin, returnedChange, 'submit');
  const returned = await decide(
    reviewer.client,
    second.data,
    'return',
    'Fix it',
  );
  expect(returned.status).toBe(200);
  expect(returned.data.status).toBe('draft');
  approval = (
    await (await admin.fetch(`/people/changes/${returnedChange.id}`)).json()
  ).data.approval as Approval;
  expect(approval.stages[0].status).toBe('returned');

  // The initiator can withdraw before anyone decides.
  const withdrawnChange = await entry();
  const third = await decide(admin, withdrawnChange, 'submit');
  const withdrawn = await decide(admin, third.data, 'withdraw', 'Not needed');
  expect(withdrawn.status).toBe(200);
  expect(withdrawn.data.status).toBe('draft');

  // All-signed stages need every candidate; one decision does not advance.
  expect((await save(stages('all'))).status).toBe(200);
  const jointChange = await entry();
  const fourth = await decide(admin, jointChange, 'submit');
  const signed = await decide(reviewer.client, fourth.data, 'approve');
  expect(signed.status).toBe(200);
  expect(signed.data.status).toBe('pending');
  expect(signed.data.approval.currentStage).toBe(0);
  const secondSignature = await decide(signer.client, signed.data, 'approve');
  expect(secondSignature.status).toBe(200);
  expect(secondSignature.data.status).toBe('pending');
  expect(secondSignature.data.approval.currentStage).toBe(1);
  const finalSignature = await decide(
    signer.client,
    secondSignature.data,
    'approve',
  );
  expect(finalSignature.status).toBe(200);
  expect(finalSignature.data.status).toBe('effective');
});

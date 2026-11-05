// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import { fixture, send, signIn } from '../helpers/purchase-requests.js';
import { createStandaloneServer } from '../../server/standalone.js';
import { businessDate } from '../../server/providers/business-date.js';
import type { PurchaseContent } from '../../server/providers/purchase-request-model.js';

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

function lineFor(
  subjectId: string,
  values: {
    name?: string;
    specification?: string;
    unit?: string;
    quantity?: string;
  } = {},
) {
  return {
    id: randomUUID(),
    selection: {
      kind: 'unknown' as const,
      subjectId,
      originalName: values.name ?? 'Merged gloves',
      originalSpecification: values.specification ?? 'M-1',
      requestedUnitText: values.unit ?? 'pair',
      quantity: values.quantity ?? '10',
    },
    originalName: '',
    originalSpecification: '',
    usage: '',
    notes: '',
  };
}

function contentFor(
  subjectId: string,
  requesterEmployeeId: string,
  requestingUnitId: string,
  line: ReturnType<typeof lineFor>,
): PurchaseContent {
  return {
    subjectId,
    requesterEmployeeId,
    requestingUnitId,
    usage: 'Group purchase verification',
    neededOn: businessDate(),
    businessDate: businessDate(),
    sourceChannel: 'manual',
    suggestedSupplierId: null,
    projectId: null,
    notes: '',
    lines: [line],
  };
}

async function personAt(
  testApp: Parameters<typeof signIn>[0],
  f: Awaited<ReturnType<typeof fixture>>,
  database: Parameters<typeof fixture>[1],
  subjectId: string,
  unitId: string,
  positionId: string,
  name: string,
) {
  const password = randomUUID(),
    user = await f.users.create({
      name,
      email: `${randomUUID()}@example.test`,
      password,
    }),
    session = await signIn(testApp, { email: user.email!, password }),
    employee = await f.create('/people/employees', {
      code: randomUUID(),
      name,
      subjectId,
      data: { accountId: user.id },
    });
  for (const table of ['personnelEmployments', 'personnelAssignments'])
    await database.repository(table).createOne({
      values: {
        id: randomUUID(),
        code: randomUUID(),
        name,
        subjectId,
        personId: employee.id,
        positionId: table === 'personnelAssignments' ? positionId : null,
        data: {
          type: table === 'personnelAssignments' ? 'primary' : 'employee',
          startDate: '2020-01-01',
          endDate: null,
        },
        status: 'active',
        revision: 1,
        lifecycleVersion: 0,
        createdBy: 'isolated-fixture',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  return { user, session, employee };
}

async function team(
  testApp: Parameters<typeof signIn>[0],
  f: Awaited<ReturnType<typeof fixture>>,
  database: Parameters<typeof fixture>[1],
  name: string,
) {
  const unit = await f.create('/organization/units', {
      code: randomUUID(),
      name: `${name} department`,
      type: 'department',
      subjectId: f.b.id,
    }),
    position = await f.create('/organization/positions', {
      code: randomUUID(),
      name: `${name} position`,
      unitId: unit.id,
    }),
    applicant = await personAt(
      testApp,
      f,
      database,
      f.b.id,
      unit.id,
      position.id,
      `${name} applicant`,
    ),
    reviewer = await personAt(
      testApp,
      f,
      database,
      f.b.id,
      unit.id,
      position.id,
      `${name} reviewer`,
    );
  for (const [who, role] of [
    [applicant, 'procurement-requester'],
    [applicant, 'procurement-source-requester'],
    [reviewer, 'procurement-request-reviewer'],
  ] as const)
    await f.authz.permissionSets.assign({
      permissionSet: role,
      subject: { type: 'user', id: who.user.id },
    });
  return { unit, position, applicant, reviewer };
}

async function saveRules(
  f: Awaited<ReturnType<typeof fixture>>,
  subjectId: string,
  reviewerId: string,
  version = 0,
) {
  const response = await send(
    f.admin,
    '/procurement/settings',
    {
      subjectId,
      version,
      requestKey: randomUUID(),
      values: {
        reviewerSelections: [
          { group: 1, type: 'user', referenceId: reviewerId },
        ],
        allowParallelGovernance: true,
        requireProject: false,
      },
    },
    'PUT',
  );
  expect(response.status).toBe(200);
}

async function groupUser(
  testApp: Parameters<typeof signIn>[0],
  f: Awaited<ReturnType<typeof fixture>>,
  actions: readonly string[],
) {
  const password = randomUUID(),
    user = await f.users.create({
      name: 'Group purchaser',
      email: `${randomUUID()}@example.test`,
      password,
    }),
    session = await signIn(testApp, { email: user.email!, password });
  await f.grant(user.id, actions, [f.a.id, f.b.id]);
  return session;
}

test('derives the caller identity from effective employments and refuses creation without one', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database),
    backup = await personAt(
      testApp,
      f,
      database,
      f.a.id,
      f.unit.id,
      f.position.id,
      'Backup applicant',
    );
  // Move the same person into a second company so the form can choose it.
  await database.repository('personnelEmployments').createOne({
    values: {
      id: randomUUID(),
      code: randomUUID(),
      name: 'Applicant secondary employment',
      subjectId: f.b.id,
      personId: f.applicant.employee.id,
      positionId: null,
      data: { type: 'employee', startDate: '2020-01-01', endDate: null },
      status: 'active',
      revision: 1,
      lifecycleVersion: 0,
      createdBy: 'isolated-fixture',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const secondUnit = await f.create('/organization/units', {
      code: randomUUID(),
      name: 'Second company department',
      type: 'department',
      subjectId: f.b.id,
    }),
    secondPosition = await f.create('/organization/positions', {
      code: randomUUID(),
      name: 'Second company position',
      unitId: secondUnit.id,
    });
  await database.repository('personnelAssignments').createOne({
    values: {
      id: randomUUID(),
      code: randomUUID(),
      name: 'Applicant secondary assignment',
      subjectId: f.b.id,
      personId: f.applicant.employee.id,
      positionId: secondPosition.id,
      data: { type: 'partTime', startDate: '2020-01-01', endDate: null },
      status: 'active',
      revision: 1,
      lifecycleVersion: 0,
      createdBy: 'isolated-fixture',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const identityResponse = await f.applicant.session.fetch(
      '/procurement/requestIdentity',
    ),
    identity = await identityResponse.json();
  expect(identityResponse.status).toBe(200);
  expect(identity.data.employee.id).toBe(f.applicant.employee.id);
  expect(
    identity.data.companies.map((company: { id: string }) => company.id).sort(),
  ).toEqual([f.a.id, f.b.id].sort());
  expect(identity.data.default.subjectId).toBe(f.a.id);
  expect(identity.data.default.unitId).toBe(f.unit.id);

  const created = await send(f.applicant.session, '/procurement/requests', {
    content: contentFor(
      f.b.id,
      f.applicant.employee.id,
      secondUnit.id,
      lineFor(f.b.id, { name: 'Second company need' }),
    ),
    requestKey: randomUUID(),
  });
  expect(created.status).toBe(201);
  expect((await created.json()).data.subjectId).toBe(f.b.id);

  const password = randomUUID(),
    unassigned = await f.users.create({
      name: 'No employment',
      email: `${randomUUID()}@example.test`,
      password,
    }),
    unassignedSession = await signIn(testApp, {
      email: unassigned.email!,
      password,
    });
  await f.grant(unassigned.id, ['read', 'create'], [f.a.id]);
  const emptyIdentity = await (
      await unassignedSession.fetch('/procurement/requestIdentity')
    ).json(),
    refused = await send(unassignedSession, '/procurement/requests', {
      content: {
        subjectId: f.a.id,
        requesterEmployeeId: null,
        requestingUnitId: null,
        usage: '',
        neededOn: null,
        suggestedSupplierId: null,
        projectId: null,
        notes: '',
        lines: [lineFor(f.a.id, { name: 'No-employment need' })],
      },
      requestKey: randomUUID(),
    });
  expect(emptyIdentity.data.employee).toBeNull();
  expect(emptyIdentity.data.companies).toEqual([]);
  expect(refused.status).toBe(400);
  expect((await refused.json()).error.reason).toBe(
    'PURCHASE_EMPLOYMENT_REQUIRED',
  );
  expect(backup.user.id).not.toBe(unassigned.id);
});

test('lists submitted requests across companies for group readers and keeps company readers scoped', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database),
    other = await team(testApp, f, database, 'List'),
    group = await groupUser(testApp, f, ['read', 'readAll']);
  await saveRules(f, f.a.id, f.reviewer.user.id);
  await saveRules(f, f.b.id, other.reviewer.user.id);
  const draftA = await f.draft(
      contentFor(
        f.a.id,
        f.applicant.employee.id,
        f.unit.id,
        lineFor(f.a.id, { name: 'Draft company A' }),
      ),
    ),
    draftB = await f.draft(
      contentFor(
        f.b.id,
        other.applicant.employee.id,
        other.unit.id,
        lineFor(f.b.id, { name: 'Draft company B' }),
      ),
      other.applicant.session,
    ),
    submittedA = await f.fire(draftA, 'submit'),
    submittedB = await f.fire(draftB, 'submit', other.applicant.session),
    draftC = await f.draft(
      contentFor(
        f.a.id,
        f.applicant.employee.id,
        f.unit.id,
        lineFor(f.a.id, { name: 'Remaining draft' }),
      ),
    );
  expect(submittedA.status).toBe('pending');
  expect(submittedB.status).toBe('pending');
  expect(draftC.status).toBe('draft');

  const groupPage = await (
      await group.fetch('/procurement/requests?submitted=true&pageSize=50')
    ).json(),
    groupAll = await (
      await group.fetch('/procurement/requests?submitted=false&pageSize=50')
    ).json(),
    oneCompany = await (
      await group.fetch(
        `/procurement/requests?subjectId=${f.a.id}&submitted=true&pageSize=50`,
      )
    ).json(),
    applicantPage = await (
      await f.applicant.session.fetch(
        '/procurement/requests?submitted=true&pageSize=50',
      )
    ).json();
  expect(groupPage.data.map((row: { id: string }) => row.id).sort()).toEqual(
    [submittedA.id, submittedB.id].sort(),
  );
  expect(groupAll.meta.total).toBe(3);
  expect(
    groupAll.data.some((row: { id: string }) => row.id === draftA.id),
  ).toBe(true);
  expect(oneCompany.data.map((row: { id: string }) => row.id)).toEqual([
    submittedA.id,
  ]);
  expect(
    applicantPage.data.every(
      (row: { subjectId: string }) => row.subjectId === f.a.id,
    ),
  ).toBe(true);
  expect(
    applicantPage.data.some((row: { id: string }) => row.id === submittedB.id),
  ).toBe(false);
});

test('merges approved lines, keeps units separate and never accumulates a repeated run', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database),
    other = await team(testApp, f, database, 'Merge'),
    group = await groupUser(testApp, f, ['read', 'readAll', 'merge']),
    readOnly = await groupUser(testApp, f, ['read', 'readAll']);
  await saveRules(f, f.a.id, f.reviewer.user.id);
  await saveRules(f, f.b.id, other.reviewer.user.id);

  const approve = async (
    content: PurchaseContent,
    applicant: typeof f.applicant,
    reviewer: typeof f.reviewer,
  ) => {
    const row = await f.fire(
      await f.draft(content, applicant.session),
      'submit',
      applicant.session,
    );
    return f.fire(row, 'approve', reviewer.session);
  };
  const pairA = await approve(
      contentFor(
        f.a.id,
        f.applicant.employee.id,
        f.unit.id,
        lineFor(f.a.id, { unit: 'pair', quantity: '10' }),
      ),
      f.applicant,
      f.reviewer,
    ),
    pairB = await approve(
      contentFor(
        f.b.id,
        other.applicant.employee.id,
        other.unit.id,
        lineFor(f.b.id, { unit: 'pair', quantity: '20' }),
      ),
      other.applicant,
      other.reviewer,
    ),
    boxA = await approve(
      contentFor(
        f.a.id,
        f.applicant.employee.id,
        f.unit.id,
        lineFor(f.a.id, { unit: 'box', quantity: '2' }),
      ),
      f.applicant,
      f.reviewer,
    ),
    pendingA = await f.fire(
      await f.draft(
        contentFor(
          f.a.id,
          f.applicant.employee.id,
          f.unit.id,
          lineFor(f.a.id, { unit: 'pair', quantity: '100' }),
        ),
      ),
      'submit',
    );
  expect(pendingA.status).toBe('pending');

  const first = await (
      await group.fetch('/procurement/merge?pageSize=50')
    ).json(),
    second = await (await group.fetch('/procurement/merge?pageSize=50')).json(),
    pair = first.data.find(
      (row: { material: { unitName: string } }) =>
        row.material.unitName === 'pair',
    ),
    box = first.data.find(
      (row: { material: { unitName: string } }) =>
        row.material.unitName === 'box',
    );
  expect(pair.quantity).toBe('30');
  expect(
    pair.sources
      .map((source: { requestId: string }) => source.requestId)
      .sort(),
  ).toEqual([pairA.id, pairB.id].sort());
  expect(
    pair.sources
      .map((source: { requestCode: string }) => source.requestCode)
      .sort(),
  ).toEqual([pairA.code, pairB.code].sort());
  expect(box.quantity).toBe('2');
  expect(first.meta.total).toBe(2);
  expect(
    second.data.find((row: { key: string }) => row.key === pair.key).quantity,
  ).toBe('30');

  const oneCompany = await (
      await group.fetch(`/procurement/merge?subjectId=${f.a.id}&pageSize=50`)
    ).json(),
    denied = await readOnly.fetch('/procurement/merge');
  expect(
    oneCompany.data.find(
      (row: { material: { unitName: string } }) =>
        row.material.unitName === 'pair',
    ).quantity,
  ).toBe('10');
  expect(denied.status).toBe(403);
  expect(boxA.id).not.toBe(pairA.id);
});

test('lets a group reviewer with positions in both companies approve across companies', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database),
    other = await team(testApp, f, database, 'Group review');
  await f.grant(
    f.reviewer.user.id,
    ['read', 'readAll', 'review'],
    [f.a.id, f.b.id],
  );
  await database.repository('personnelEmployments').createOne({
    values: {
      id: randomUUID(),
      code: randomUUID(),
      name: 'Group reviewer secondary employment',
      subjectId: f.b.id,
      personId: f.reviewer.employee.id,
      positionId: null,
      data: { type: 'employee', startDate: '2020-01-01', endDate: null },
      status: 'active',
      revision: 1,
      lifecycleVersion: 0,
      createdBy: 'isolated-fixture',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await database.repository('personnelAssignments').createOne({
    values: {
      id: randomUUID(),
      code: randomUUID(),
      name: 'Group reviewer secondary assignment',
      subjectId: f.b.id,
      personId: f.reviewer.employee.id,
      positionId: other.position.id,
      data: { type: 'partTime', startDate: '2020-01-01', endDate: null },
      status: 'active',
      revision: 1,
      lifecycleVersion: 0,
      createdBy: 'isolated-fixture',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await saveRules(f, f.a.id, f.reviewer.user.id);
  await saveRules(f, f.b.id, f.reviewer.user.id);
  const requestA = await f.fire(
      await f.draft(
        contentFor(
          f.a.id,
          f.applicant.employee.id,
          f.unit.id,
          lineFor(f.a.id, { name: 'Group review A' }),
        ),
      ),
      'submit',
    ),
    requestB = await f.fire(
      await f.draft(
        contentFor(
          f.b.id,
          other.applicant.employee.id,
          other.unit.id,
          lineFor(f.b.id, { name: 'Group review B' }),
        ),
        other.applicant.session,
      ),
      'submit',
      other.applicant.session,
    );
  const approvedA = await f.fire(requestA, 'approve', f.reviewer.session),
    approvedB = await f.fire(requestB, 'approve', f.reviewer.session);
  expect([approvedA.status, approvedB.status]).toEqual([
    'approved',
    'approved',
  ]);
});

test('seeds a group purchaser role with readAll and merge but no assignments', async ({
  database,
}) => {
  const role = await database
      .repository('authorizationPermissionSets')
      .findOne({ filter: { key: 'procurement-group-purchaser' } }),
    grants = role!.grants as {
      resource: { type: string; id: string };
      actions: { action: string }[];
    }[];
  expect(role).toBeTruthy();
  expect(grants).toContainEqual({
    resource: { type: 'page', id: 'procurement-requests' },
    actions: [{ action: 'access' }],
  });
  const actions = grants
    .find((grant) => grant.resource.id === 'procurement.requests')!
    .actions.map((action) => action.action);
  expect(actions.sort()).toEqual(['merge', 'read', 'readAll', 'review'].sort());
  expect(
    await database.repository('authorizationPermissionSetAssignments').count({
      filter: { permissionSetKey: 'procurement-group-purchaser' },
    }),
  ).toBe(0);
});

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
import {
  apiDocsToken,
  findApiDocumentSchemaProblems,
  findUndeclaredApiRoutes,
} from '@nocobase/app-server/router';
import { createStandaloneServer } from '../../server/standalone.js';
import { businessDate } from '../../server/providers/business-date.js';
import { peopleServiceToken } from '../../server/providers/people.js';

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
test('protects people routes before validation and separates personnel from talent permissions', async ({
  testApp,
  request,
}) => {
  expect((await request('/people/employees')).status).toBe(401);
  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const password = randomUUID(),
    email = `people-${randomUUID()}@example.test`;
  const user = await users.create({
    name: 'Personnel reader',
    email,
    password,
  });
  const client = await signIn(testApp, { email, password });
  expect((await client.fetch('/people/employees')).status).toBe(403);
  const authz = testApp.application.container.resolve(authorizationToken);
  const assignment = await authz.permissionSets.assign({
    permissionSet: 'personnel-reader',
    subject: { type: 'user', id: user.id },
  });
  expect((await client.fetch('/people/employees')).status).toBe(200);
  expect((await client.fetch('/people/profiles')).status).toBe(403);
  expect(
    (
      await client.fetch('/people/employees', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({ unknownField: true }),
      })
    ).status,
  ).toBe(403);
  await authz.permissionSets.revoke(assignment.id);
  expect((await client.fetch('/people/employees')).status).toBe(403);
});
test('creates employees, applies entry atomically and keeps evaluation standards historical', async ({
  testApp,
  database,
}) => {
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
    const r = await send(path, body);
    const p = await r.json();
    expect(r.status).toBe(201);
    return p.data;
  };
  const subject = await create('/organization/subjects', {
    code: 'PEOPLE-GROUP',
    name: 'Test group',
    type: 'group',
  });
  const unit = await create('/organization/units', {
    code: 'PEOPLE-UNIT',
    name: 'Test unit',
    type: 'department',
    subjectId: subject.id,
  });
  const position = await create('/organization/positions', {
    code: 'PEOPLE-JOB',
    name: 'Test engineer',
    unitId: unit.id,
  });
  const employee = await create('/people/employees', {
    code: 'E-001',
    name: 'Test employee',
    subjectId: subject.id,
    data: {},
  });
  const change = await create('/people/changes', {
    code: 'ENTRY-001',
    name: 'Entry',
    personId: employee.id,
    data: {
      type: 'entry',
      effectiveDate: businessDate(),
      targetSubjectId: subject.id,
      targetPositionId: position.id,
      explanation: 'Hire approved',
    },
  });
  const fire = async (
    kind: string,
    row: { id: string; lifecycleVersion: number },
    transition: string,
    input: unknown = {},
  ) => {
    const r = await send(`/people/${kind}/${row.id}/fire`, {
      transition,
      version: row.lifecycleVersion,
      requestId: randomUUID(),
      reason: 'Test decision',
      input,
    });
    const p = await r.json();
    expect(r.status).toBe(200);
    return p.data;
  };
  const pending = await fire('changes', change, 'submit');
  const effective = await fire('changes', pending, 'approve');
  expect(effective.status).toBe('effective');
  expect(await database.repository('personnelEmployments').count()).toBe(1);
  expect(await database.repository('personnelAssignments').count()).toBe(1);
  const dimension = await create('/people/dimensions', {
    code: 'LEARN',
    name: 'Learning',
    data: {
      category: 'common',
      definition: 'Learn and apply',
      standards: ['One', 'Two', 'Three', 'Four', 'Five'],
      evidence: 'Work examples',
    },
  });
  const model = await create('/people/models', {
    code: 'MODEL',
    name: 'Engineer model',
    positionId: position.id,
    data: { items: [{ dimensionId: dimension.id, target: 4 }] },
  });
  const profileRow = (
    await (await admin.fetch(`/people/profiles?personId=${employee.id}`)).json()
  ).data[0];
  const profileResponse = await send(
    `/people/profiles/${profileRow.id}`,
    {
      version: profileRow.version,
      reason: 'Set talent model',
      data: { ...profileRow.data, grade: 3, modelId: model.id },
    },
    'PATCH',
  );
  if (profileResponse.status !== 200)
    throw new Error(await profileResponse.clone().text());
  expect(profileResponse.status).toBe(200);
  const profile = (await profileResponse.json()).data;
  expect(profile.grade).toBe(3);
  const careerResponse = await admin.fetch(
    `/people/employees/${employee.id}/career`,
  );
  expect(careerResponse.status).toBe(200);
  const career = (await careerResponse.json()).data;
  expect(career.asOf).toBe(businessDate());
  expect(career.changes.rows.map((row: { id: string }) => row.id)).toContain(
    effective.id,
  );
  expect(career.assignments.rows).toHaveLength(1);
  expect(career.employments.rows).toHaveLength(1);
  expect(
    career.audits.rows.some(
      (audit: { kind: string; operation: string; recordId: string }) =>
        audit.kind === 'profiles' &&
        audit.operation === 'save' &&
        audit.recordId === profile.id,
    ),
  ).toBe(true);
  const evaluation = await create('/people/evaluations', {
    code: 'EV-001',
    name: 'Annual evaluation',
    personId: employee.id,
    data: {
      period: '2026',
      evaluationDate: businessDate(),
      modelId: model.id,
      ratings: [{ dimensionId: dimension.id }],
    },
  });
  const self = await fire('evaluations', evaluation, 'selfAssess', {
    ratings: [
      { dimensionId: dimension.id, score: 4.2, evidence: 'Project learning' },
    ],
  });
  const manager = await fire('evaluations', self, 'managerAssess', {
    ratings: [
      { dimensionId: dimension.id, score: 4, evidence: 'Observed outcomes' },
    ],
  });
  const confirmed = await fire('evaluations', manager, 'confirm', {
    ratings: [
      { dimensionId: dimension.id, score: 4.1, evidence: 'Confirmed examples' },
    ],
  });
  expect(confirmed.status).toBe('confirmed');
  expect(confirmed.data.ratings[0].selfScore).toBe(4.2);
  expect(confirmed.data.ratings[0].managerScore).toBe(4);
  expect(confirmed.data.ratings[0].confirmedScore).toBe(4.1);
  expect(
    (
      await send(
        `/people/evaluations/${evaluation.id}`,
        {
          version: confirmed.version,
          reason: 'Do not overwrite',
          name: 'Changed',
        },
        'PATCH',
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await send(
        `/people/dimensions/${dimension.id}`,
        {
          version: dimension.version,
          reason: 'Improve standard',
          data: {
            ...dimension.data,
            standards: ['New one', 'Two', 'Three', 'Four', 'Five'],
          },
        },
        'PATCH',
      )
    ).status,
  ).toBe(200);
  const historic = await (
    await admin.fetch(`/people/evaluations/${evaluation.id}`)
  ).json();
  expect(historic.data.snapshot.dimensions[0].standards[0]).toBe('One');
  const overview = await (await admin.fetch('/people/overview')).json();
  expect(overview.data.counts.activePeople).toBe(1);
  expect(overview.data.counts.evaluations).toBe(1);
  await create('/people/evaluations', {
    code: 'EV-DRAFT',
    name: 'Unconfirmed draft',
    personId: employee.id,
    data: {
      period: '2026',
      evaluationDate: businessDate(),
      modelId: model.id,
      ratings: [{ dimensionId: dimension.id }],
    },
  });
  const development = await create('/people/developmentPlans', {
    code: 'DEV-DRAFT',
    name: 'Pending development',
    personId: employee.id,
    data: {
      goal: 'Improve skills',
      measures: 'Mentor review',
      owner: 'Mentor',
      dueDate: businessDate(),
    },
  });
  const pendingOverview = await (await admin.fetch('/people/overview')).json();
  expect(pendingOverview.data.counts.evaluations).toBe(1);
  expect(pendingOverview.data.counts.developmentPlans).toBe(1);
  expect(pendingOverview.data.counts.workforcePlans).toBe(0);
  const activeDevelopment = await fire(
    'developmentPlans',
    development,
    'activate',
  );
  await fire('developmentPlans', activeDevelopment, 'complete', {
    result: 'Evidence recorded',
    progress: 'Completed',
  });
  expect(
    (await (await admin.fetch('/people/overview')).json()).data.counts
      .developmentPlans,
  ).toBe(0);

  expect(
    (
      await send(
        `/people/employees/${employee.id}`,
        { version: employee.version, reason: 'Stale', name: 'Bad' },
        'PATCH',
      )
    ).status,
  ).toBe(409);
});
test('closes the account and revokes direct roles when a departure takes effect', async ({
  testApp,
  database,
}) => {
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
  const fire = async (
    row: { id: string; lifecycleVersion: number },
    transition: string,
  ) => {
    const response = await send(`/people/changes/${row.id}/fire`, {
      transition,
      version: row.lifecycleVersion,
      requestId: randomUUID(),
      reason: 'Test decision',
      input: {},
    });
    const payload = await response.json();
    expect(response.status).toBe(200);
    return payload.data;
  };
  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const authz = testApp.application.container.resolve(authorizationToken);
  const password = randomUUID(),
    email = `departure-${randomUUID()}@example.test`;
  const account = await users.create({
    name: 'Departing employee',
    email,
    password,
  });
  await authz.permissionSets.assign({
    permissionSet: 'personnel-reader',
    subject: { type: 'user', id: account.id },
  });
  const subject = await create('/organization/subjects', {
    code: 'EXIT-GROUP',
    name: 'Exit group',
    type: 'group',
  });
  const unit = await create('/organization/units', {
    code: 'EXIT-UNIT',
    name: 'Exit unit',
    type: 'department',
    subjectId: subject.id,
  });
  const position = await create('/organization/positions', {
    code: 'EXIT-JOB',
    name: 'Exit position',
    unitId: unit.id,
  });
  const employee = await create('/people/employees', {
    code: 'EXIT-EMP',
    name: 'Departing employee',
    subjectId: subject.id,
    data: { accountId: account.id },
  });
  const entry = await create('/people/changes', {
    code: 'EXIT-ENTRY',
    name: 'Entry',
    personId: employee.id,
    data: {
      type: 'entry',
      effectiveDate: businessDate(),
      targetSubjectId: subject.id,
      targetPositionId: position.id,
      explanation: 'Hire approved',
    },
  });
  await fire(await fire(entry, 'submit'), 'approve');
  const accountClient = await signIn(testApp, { email, password });
  expect((await accountClient.fetch('/people/employees')).status).toBe(200);
  const readerCareerResponse = await accountClient.fetch(
    `/people/employees/${employee.id}/career`,
  );
  expect(readerCareerResponse.status).toBe(200);
  const readerCareer = (await readerCareerResponse.json()).data;
  expect(readerCareer.audits).toBeNull();
  expect(readerCareer.changes.rows).toHaveLength(1);
  const exit = await create('/people/changes', {
    code: 'EXIT-001',
    name: 'Departure',
    personId: employee.id,
    data: {
      type: 'exit',
      effectiveDate: businessDate(),
      explanation: 'Departure approved',
    },
  });
  const applied = await fire(await fire(exit, 'submit'), 'approve');
  expect(applied.status).toBe('effective');
  const stored = await database
    .repository('personnelEmployees')
    .findOne({ filter: { id: employee.id } });
  expect(stored?.status).toBe('inactive');
  // The talent card follows the employee out of the company.
  expect(
    (
      await database
        .repository('hrProfiles')
        .findOne({ filter: { personId: employee.id } })
    )?.status,
  ).toBe('inactive');
  const talent = await (
    await admin.fetch(`/people/talent/${employee.id}`)
  ).json();
  expect(talent.data.phase.phase).toBe('departed');
  expect(talent.data.phase.since).toBe(businessDate());
  expect(stored?.accountId).toBeNull();
  expect(stored?.data).toMatchObject({ accountId: null });
  expect((await users.get(account.id))?.disabledAt).not.toBeNull();
  const assignments = await authz.permissionSets.listAssignments();
  expect(
    assignments.some(
      (assignment) =>
        assignment.subject.type === 'user' &&
        assignment.subject.id === account.id,
    ),
  ).toBe(false);
  expect((await accountClient.fetch('/people/employees')).status).toBe(401);
});
test('documents the new endpoints without undocumented routes or schema errors', async ({
  testApp,
}) => {
  expect(findUndeclaredApiRoutes(testApp.application)).toEqual([]);
  const doc = await testApp.application.container
    .resolve(apiDocsToken)
    .getDocument();
  expect(findApiDocumentSchemaProblems(doc)).toEqual([]);
  expect(doc.paths?.['/api/people/employees']?.post?.operationId).toBe(
    'peopleCreateemployees',
  );
});

test('enforces company scopes on rows, options, creates and separate contact information', async ({
  testApp,
  database,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const create = async (path: string, body: unknown) => {
    const r = await admin.fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
    const p = await r.json();
    expect(r.status).toBe(201);
    return p.data;
  };
  const a = await create('/organization/subjects', {
    code: 'SCOPE-A',
    name: 'Scope A',
    type: 'group',
  });
  const b = await create('/organization/subjects', {
    code: 'SCOPE-B',
    name: 'Scope B',
    type: 'group',
  });
  const one = await create('/people/employees', {
    code: 'SCOPE-E1',
    name: 'A employee',
    subjectId: a.id,
    data: {},
  });
  const two = await create('/people/employees', {
    code: 'SCOPE-E2',
    name: 'B employee',
    subjectId: b.id,
    data: {},
  });
  const users = testApp.application.container.resolve(
      userAdministrationServiceToken,
    ),
    authz = testApp.application.container.resolve(authorizationToken);
  const email = `scope-${randomUUID()}@example.test`,
    password = randomUUID();
  const user = await users.create({
    name: 'Company A personnel',
    email,
    password,
  });
  const scopes = {
    employees: {
      type: 'recordAccess' as const,
      key: 'people.companies',
      params: { subjectIds: [a.id] },
    },
    orgSubjects: 'allRecords',
    orgUnits: 'allRecords',
    orgPositions: 'allRecords',
  };
  const role = await authz.permissionSets.create({
    key: `company-${randomUUID()}`,
    title: 'Scoped personnel',
    grants: [
      {
        resource: { type: 'composite', id: 'people.employees' },
        actions: ['read', 'update'].map((action) => ({
          action,
          policy: { type: 'composite', scopes },
        })),
      },
    ],
  });
  await authz.permissionSets.assign({
    permissionSet: role.key,
    subject: { type: 'user', id: user.id },
  });
  const member = await signIn(testApp, { email, password });
  const list = await (await member.fetch('/people/employees')).json();
  expect(list.data.map((r: { id: string }) => r.id)).toEqual([one.id]);
  expect((await member.fetch(`/people/employees/${two.id}`)).status).toBe(404);
  const options = await (
    await member.fetch('/people/options?kind=employees')
  ).json();
  expect(options.data.employees.rows.map((r: { id: string }) => r.id)).toEqual([
    one.id,
  ]);
  const before = await database.repository('personnelEmployees').count();
  const denied = await member.fetch('/people/employees', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({
      code: 'OUTSIDE',
      name: 'Denied',
      subjectId: b.id,
      data: {},
    }),
  });
  expect(denied.status).toBe(403);
  expect(await database.repository('personnelEmployees').count()).toBe(before);
  expect(
    (await member.fetch(`/people/employees/${one.id}/contacts`)).status,
  ).toBe(403);
  await authz.permissionSets.assign({
    permissionSet: 'personnel-sensitive-reader',
    subject: { type: 'user', id: user.id },
  });
  expect(
    (await member.fetch(`/people/employees/${one.id}/contacts`)).status,
  ).toBe(200);
  expect(
    (await member.fetch(`/people/employees/${two.id}/contacts`)).status,
  ).toBe(404);
  const badGrade = await admin.fetch('/people/profiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({
      code: 'BAD-GRADE',
      name: 'Bad grade',
      personId: one.id,
      data: { grade: 6 },
    }),
  });
  expect(badGrade.status).toBe(400);
});

test('uses the official file repository and keeps employee photos private', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const form = new FormData();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR6kAAAAASUVORK5CYII=',
    'base64',
  );
  form.set('file', new File([png], 'avatar.png', { type: 'image/png' }));
  const response = await admin.fetch('/peoplePhotos/uploadOne', {
    method: 'POST',
    headers: { origin: 'http://localhost' },
    body: form,
  });
  const result = await response.json();
  expect(response.status).toBe(201);
  expect(result.data.record.ext).toBe('png');
  const anonymous = await testApp.fetch(
    new Request(
      `http://localhost${testApp.publicBasePath}/uploads/peoplePhotos/${result.data.record.id}.png`,
    ),
  );
  expect(anonymous.status).toBe(401);
  const bad = new FormData();
  bad.set('file', new File(['not an image'], 'bad.png', { type: 'image/png' }));
  expect(
    (
      await admin.fetch('/peoplePhotos/uploadOne', {
        method: 'POST',
        headers: { origin: 'http://localhost' },
        body: bad,
      })
    ).status,
  ).toBe(400);
});

test('rejects transactions the employee cannot start and rolls back a conflicting entry', async ({
  testApp,
  database,
}) => {
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
  const person = await database
    .repository('personnelEmployees')
    .findOne({ filter: { code: 'E-001' } });
  const assignment = await database
    .repository('personnelAssignments')
    .findOne({ filter: { personId: String(person!.id) } });
  const position = await database
    .repository('orgPositions')
    .findOne({ filter: { id: String(assignment!.positionId) } });
  const stopped = await send(
    `/organization/positions/${position!.id}/setStatus`,
    {
      version: Number(position!.revision),
      reason: 'Still occupied',
      status: 'inactive',
    },
  );
  expect(stopped.status).toBe(400);
  expect((await stopped.json()).error.reason).toBe('ORG_PERSONNEL_DEPENDENTS');
  // An employed person can no longer be onboarded: the type is refused when the
  // draft is created, before it can ever reach an approver.
  const duplicate = await send('/people/changes', {
    code: 'DUPLICATE-ENTRY',
    name: 'Duplicate entry',
    personId: person!.id,
    data: {
      type: 'entry',
      effectiveDate: businessDate(),
      targetSubjectId: person!.subjectId,
      targetPositionId: position!.id,
      explanation: 'Must not duplicate',
    },
  });
  expect(duplicate.status).toBe(400);
  expect((await duplicate.json()).error.reason).toBe(
    'PEOPLE_CHANGE_TYPE_CONFLICT',
  );
  // Two drafts are legal while the employee is not onboarded; applying the
  // second one must fail without touching the records created by the first.
  const created = await send('/people/employees', {
    code: 'E-002',
    name: 'Second employee',
    subjectId: person!.subjectId,
    data: {},
  });
  expect(created.status).toBe(201);
  const employee = (await created.json()).data;
  // A dedicated position keeps the workforce baseline of the seeded job intact.
  const unit = await (
    await send('/organization/units', {
      code: 'CONFLICT-UNIT',
      name: 'Conflict unit',
      type: 'department',
      subjectId: person!.subjectId,
    })
  ).json();
  const conflictPosition = await (
    await send('/organization/positions', {
      code: 'CONFLICT-JOB',
      name: 'Conflict role',
      unitId: unit.data.id,
    })
  ).json();
  const draft = async (code: string) =>
    (
      await (
        await send('/people/changes', {
          code,
          name: 'Entry',
          personId: employee.id,
          data: {
            type: 'entry',
            effectiveDate: businessDate(),
            targetSubjectId: employee.subjectId,
            targetPositionId: conflictPosition.data.id,
            explanation: 'Once only',
          },
        })
      ).json()
    ).data;
  const submit = async (row: { id: string; lifecycleVersion: number }) =>
    (
      await (
        await send(`/people/changes/${row.id}/fire`, {
          transition: 'submit',
          version: row.lifecycleVersion,
          requestId: randomUUID(),
          reason: 'Submit',
        })
      ).json()
    ).data;
  const approve = async (row: { id: string; lifecycleVersion: number }) =>
    send(`/people/changes/${row.id}/fire`, {
      transition: 'approve',
      version: row.lifecycleVersion,
      requestId: randomUUID(),
      reason: 'Apply once',
    });
  const pendingFirst = await submit(await draft('ENTRY-1'));
  const pendingSecond = await submit(await draft('ENTRY-2'));
  const applied = await approve(pendingFirst);
  expect(applied.status).toBe(200);
  const assignments = await database.repository('personnelAssignments').count();
  const employments = await database.repository('personnelEmployments').count();
  const conflicted = await approve(pendingSecond);
  expect(conflicted.status).toBe(400);
  expect(await database.repository('personnelAssignments').count()).toBe(
    assignments,
  );
  expect(await database.repository('personnelEmployments').count()).toBe(
    employments,
  );
  expect(
    (await database
      .repository('personnelChanges')
      .findOne({ filter: { id: pendingSecond.id } }))!.status,
  ).toBe('pending');
  expect(
    await testApp.application.container.resolve(peopleServiceToken).applyDue(),
  ).toEqual([]);
});

test('keeps workforce baselines, approvals, execution evidence and revised versions separate', async ({
  testApp,
  database,
}) => {
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
    const r = await send(path, body);
    if (r.status !== 201) throw new Error(await r.text());
    return (await r.json()).data;
  };
  const fire = async (
    row: { id: string; lifecycleVersion: number },
    transition: string,
    input: unknown = {},
  ) => {
    const r = await send(`/people/workforcePlans/${row.id}/fire`, {
      transition,
      version: row.lifecycleVersion,
      requestId: randomUUID(),
      reason: 'Planning review',
      input,
    });
    if (r.status !== 200) throw new Error(await r.text());
    return (await r.json()).data;
  };
  const subject = await database
    .repository('orgSubjects')
    .findOne({ filter: { code: 'PEOPLE-GROUP' } });
  const position = await database
    .repository('orgPositions')
    .findOne({ filter: { code: 'PEOPLE-JOB' } });
  const date = businessDate();
  const data = {
    period: '2027',
    baselineDate: date,
    basis: 'New operating requirements',
    items: [
      {
        positionId: position!.id,
        requested: 2,
        owner: 'Workforce owner',
        dueDate: date,
        approach: 'recruit',
        basis: 'Additional engineering coverage',
      },
    ],
  };
  const plan = await create('/people/workforcePlans', {
    code: 'PLAN-2027',
    name: 'Group workforce plan',
    subjectId: subject!.id,
    data,
  });
  expect(plan.snapshot.items[0].baseline).toBe(1);
  const submitted = await fire(plan, 'submit');
  const companyConfirmed = await fire(submitted, 'companyConfirm');
  const approved = await fire(companyConfirmed, 'approve', {
    items: [{ positionId: position!.id, approved: 2 }],
  });
  expect(approved.status).toBe('approved');
  expect(approved.data.items[0].requested).toBe(2);
  expect(approved.data.items[0].approved).toBe(2);
  expect(
    (
      await send(
        `/people/workforcePlans/${plan.id}`,
        {
          version: approved.version,
          reason: 'Must remain frozen',
          data: { ...approved.data, basis: 'Changed' },
        },
        'PATCH',
      )
    ).status,
  ).toBe(400);
  const baseline = await database
    .repository('personnelAssignments')
    .findOne({ filter: { positionId: String(position!.id) } });
  const invalid = await send(`/people/workforcePlans/${plan.id}/fire`, {
    transition: 'progress',
    version: approved.lifecycleVersion,
    requestId: randomUUID(),
    reason: 'Cannot reuse baseline staff',
    input: {
      progress: 'Claimed complete',
      taskResults: [
        {
          positionId: position!.id,
          owner: 'Workforce owner',
          status: 'completed',
          result: 'A baseline employee is not a new arrival',
          assignmentIds: [baseline!.id],
        },
      ],
    },
  });
  expect(invalid.status).toBe(400);
  const employee = await create('/people/employees', {
    code: 'PLAN-NEW-EMPLOYEE',
    name: 'New engineering employee',
    subjectId: subject!.id,
    data: {},
  });
  let entry = await create('/people/changes', {
    code: 'PLAN-ENTRY',
    name: 'Planned arrival',
    personId: employee.id,
    data: {
      type: 'entry',
      effectiveDate: date,
      targetSubjectId: subject!.id,
      targetPositionId: position!.id,
      explanation: 'Workforce plan execution',
    },
  });
  for (const transition of ['submit', 'approve']) {
    const r = await send(`/people/changes/${entry.id}/fire`, {
      transition,
      version: entry.lifecycleVersion,
      requestId: randomUUID(),
      reason: 'Arrival approved',
    });
    if (r.status !== 200) throw new Error(await r.text());
    entry = (await r.json()).data;
  }
  const actual = await database
    .repository('personnelAssignments')
    .findOne({ filter: { personId: employee.id } });
  const progressed = await fire(approved, 'progress', {
    progress: 'New employee arrived',
    taskResults: [
      {
        positionId: position!.id,
        owner: 'Workforce owner',
        status: 'completed',
        result: 'Entry and assignment effective',
        assignmentIds: [actual!.id],
      },
    ],
  });
  expect(progressed.data.taskResults[0].status).toBe('completed');
  const current = await (
    await admin.fetch(`/people/workforcePlans/${plan.id}`)
  ).json();
  expect(current.data.snapshot.items[0].baseline).toBe(1);
  expect(current.data.currentStaffing[String(position!.id)]).toBe(2);
  const revision = await create('/people/workforcePlans', {
    code: 'PLAN-2027-V2',
    name: 'Adjusted workforce plan',
    subjectId: subject!.id,
    data: {
      ...data,
      previousId: plan.id,
      items: [{ ...data.items[0], requested: 3 }],
    },
  });
  const revised = await fire(
    await fire(await fire(revision, 'submit'), 'companyConfirm'),
    'approve',
    { items: [{ positionId: position!.id, approved: 3 }] },
  );
  expect(revised.snapshot.items[0].baseline).toBe(2);
  const old = await (
    await admin.fetch(`/people/workforcePlans/${plan.id}`)
  ).json();
  expect(old.data.status).toBe('superseded');
  expect(old.data.snapshot.approvedItems[0].approved).toBe(2);
});

test('leaves future approved entries unapplied and prevents stale decisions after draft edits', async ({
  testApp,
  database,
}) => {
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
  const subject = await database
    .repository('orgSubjects')
    .findOne({ filter: { code: 'PEOPLE-GROUP' } });
  const position = await database
    .repository('orgPositions')
    .findOne({ filter: { code: 'PEOPLE-JOB' } });
  const employeeResponse = await send('/people/employees', {
    code: 'FUTURE-EMP',
    name: 'Future employee',
    subjectId: subject!.id,
    data: {},
  });
  const employee = (await employeeResponse.json()).data;
  const future = new Date(Date.parse(businessDate() + 'T00:00:00Z') + 86400000)
    .toISOString()
    .slice(0, 10);
  const r = await send('/people/changes', {
    code: 'FUTURE-ENTRY',
    name: 'Future entry',
    personId: employee.id,
    data: {
      type: 'entry',
      effectiveDate: future,
      targetSubjectId: subject!.id,
      targetPositionId: position!.id,
      explanation: 'Future date',
    },
  });
  const draft = (await r.json()).data;
  const edited = await send(
    `/people/changes/${draft.id}`,
    {
      version: draft.version,
      reason: 'Update explanation',
      name: 'Edited future entry',
    },
    'PATCH',
  );
  expect(edited.status).toBe(200);
  const latest = (await edited.json()).data;
  expect(latest.personId).toBe(employee.id);
  const stale = await send(`/people/changes/${draft.id}/fire`, {
    transition: 'submit',
    version: draft.lifecycleVersion,
    requestId: randomUUID(),
    reason: 'Stale decision',
  });
  expect(stale.status).toBe(409);
  const requestId = randomUUID();
  const payload = {
    transition: 'submit',
    version: latest.lifecycleVersion,
    requestId,
    reason: 'Submit future entry',
  };
  const submitted = await send(`/people/changes/${draft.id}/fire`, payload);
  expect(submitted.status).toBe(200);
  const pending = (await submitted.json()).data;
  expect((await send(`/people/changes/${draft.id}/fire`, payload)).status).toBe(
    200,
  );
  const approved = await send(`/people/changes/${draft.id}/fire`, {
    transition: 'approve',
    version: pending.lifecycleVersion,
    requestId: randomUUID(),
    reason: 'Approve future entry',
  });
  expect(approved.status).toBe(200);
  expect((await approved.json()).data.status).toBe('approved');
  expect(
    await database
      .repository('personnelAssignments')
      .count({ filter: { personId: employee.id } }),
  ).toBe(0);
  await testApp.application.container.resolve(peopleServiceToken).applyDue();
  expect(
    await database
      .repository('personnelAssignments')
      .count({ filter: { personId: employee.id } }),
  ).toBe(0);
});

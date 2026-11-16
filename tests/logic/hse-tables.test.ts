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

const today = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });

test('manages HSE inspections, work permits, training records and actions', async ({
  testApp,
  request,
}) => {
  expect((await request('/hse/inspections')).status).toBe(401);

  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
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
    const payload = await response.json();
    expect(response.status).toBe(201);
    return payload.data;
  };

  const company = await create('/organization/subjects', {
    code: `HSE-${randomUUID().slice(0, 6)}`,
    name: 'HSE tables company',
    type: 'group',
  });
  const unit = await create('/organization/units', {
    code: `HSE-U-${randomUUID().slice(0, 6)}`,
    name: 'HSE tables line',
    type: 'department',
    subjectId: company.id,
  });
  const position = await create('/organization/positions', {
    code: `HSE-P-${randomUUID().slice(0, 6)}`,
    name: 'HSE tables engineer',
    unitId: unit.id,
  });
  const employee = await create('/people/employees', {
    code: `HSE-E-${randomUUID().slice(0, 6)}`,
    name: 'HSE tables employee',
    subjectId: company.id,
    data: {},
  });
  const otherCompany = await create('/organization/subjects', {
    code: `HSE-O-${randomUUID().slice(0, 6)}`,
    name: 'HSE tables other company',
    type: 'group',
  });
  const otherUnit = await create('/organization/units', {
    code: `HSE-OU-${randomUUID().slice(0, 6)}`,
    name: 'HSE tables other line',
    type: 'department',
    subjectId: otherCompany.id,
  });
  const otherPosition = await create('/organization/positions', {
    code: `HSE-OP-${randomUUID().slice(0, 6)}`,
    name: 'HSE tables other engineer',
    unitId: otherUnit.id,
  });
  const otherEmployee = await create('/people/employees', {
    code: `HSE-OE-${randomUUID().slice(0, 6)}`,
    name: 'HSE tables other employee',
    subjectId: otherCompany.id,
    data: {},
  });
  const firePeople = async (
    kind: string,
    row: { id: string; lifecycleVersion: number },
    transition: string,
    input: unknown = {},
  ) => {
    const response = await send(
      admin,
      `/people/${kind}/${row.id}/fire`,
      {
        transition,
        version: row.lifecycleVersion,
        requestId: randomUUID(),
        reason: 'Test decision',
        input,
      },
      'POST',
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    return payload.data;
  };
  const hire = async (
    personId: string,
    targetSubjectId: string,
    targetPositionId: string,
    code: string,
  ) => {
    const change = await create('/people/changes', {
      code,
      name: 'Entry',
      personId,
      data: {
        type: 'entry',
        effectiveDate: today(),
        targetSubjectId,
        targetPositionId,
        explanation: 'HSE tables test hire',
      },
    });
    const pending = await firePeople('changes', change, 'submit');
    return firePeople('changes', pending, 'approve');
  };
  expect(
    await hire(
      employee.id,
      company.id,
      position.id,
      `HSE-ENTRY-${randomUUID().slice(0, 6)}`,
    ),
  ).toMatchObject({ status: 'effective' });
  expect(
    await hire(
      otherEmployee.id,
      otherCompany.id,
      otherPosition.id,
      `HSE-OENTRY-${randomUUID().slice(0, 6)}`,
    ),
  ).toMatchObject({ status: 'effective' });

  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const authz = testApp.application.container.resolve(authorizationToken);
  const makeUser = async (name: string, actions: string[]) => {
    const email = `${randomUUID()}@example.test`;
    const password = randomUUID();
    const account = await users.create({ name, email, password });
    const role = await authz.permissionSets.create({
      key: `hse-tables-${randomUUID()}`,
      title: name,
      grants: [
        {
          resource: { type: 'settings', id: 'hse' },
          actions: actions.map((action) => ({ action })),
        },
      ],
    });
    await authz.permissionSets.assign({
      permissionSet: role.key,
      subject: { type: 'user', id: account.id },
    });
    return {
      id: account.id,
      client: await signIn(testApp, { email, password }),
    };
  };
  const manager = await makeUser('HSE tables manager', [
    'read',
    'manage',
    'readAll',
  ]);
  const approver = await makeUser('HSE tables approver', [
    'read',
    'approve',
    'readAll',
  ]);
  const scopedManager = await makeUser('HSE tables scoped manager', [
    'read',
    'manage',
  ]);
  const scopedPerson = await create('/people/employees', {
    code: `HSE-SE-${randomUUID().slice(0, 6)}`,
    name: 'HSE tables scoped person',
    subjectId: company.id,
    data: { accountId: scopedManager.id },
  });
  const scopedChange = await create('/people/changes', {
    code: `HSE-SENTRY-${randomUUID().slice(0, 6)}`,
    name: 'Entry',
    personId: scopedPerson.id,
    data: {
      type: 'entry',
      effectiveDate: today(),
      targetSubjectId: company.id,
      targetPositionId: position.id,
      explanation: 'HSE tables scoped manager hire',
    },
  });
  const scopedPending = await firePeople('changes', scopedChange, 'submit');
  await firePeople('changes', scopedPending, 'approve');

  // --- Inspections: create, list, complete --------------------------------
  const inspection = await create('/hse/inspections', {
    subjectId: company.id,
    unitId: unit.id,
    type: 'routine',
    plannedAt: today(),
    inspectorId: employee.id,
    checklist: ['Guards in place', 'Emergency exits clear'],
  });
  expect(inspection).toMatchObject({
    subjectId: company.id,
    status: 'planned',
    findingsCount: 0,
    checklist: ['Guards in place', 'Emergency exits clear'],
  });
  const inspectionList = await (
    await admin.fetch(
      `/hse/inspections?subjectId=${company.id}&page=1&pageSize=20`,
    )
  ).json();
  expect(inspectionList.meta.total).toBe(1);
  expect(inspectionList.data[0]).toMatchObject({
    id: inspection.id,
    inspectorName: 'HSE tables employee',
  });
  const completedInspection = await send(
    manager.client,
    `/hse/inspections/${inspection.id}/transitions`,
    { version: inspection.version, action: 'complete', findingsCount: 4 },
  );
  expect(completedInspection.status).toBe(200);
  const completedInspectionJson = (await completedInspection.json()).data;
  expect(completedInspectionJson.status).toBe('completed');
  expect(completedInspectionJson.findingsCount).toBe(4);
  expect(completedInspectionJson.completedAt).toBeTruthy();

  // --- Work permits: create, list, submit, approve ------------------------
  const permitWindow = {
    validFrom: new Date(Date.now() + 3_600_000).toISOString(),
    validTo: new Date(Date.now() + 9 * 3_600_000).toISOString(),
  };
  const permit = await create('/hse/work-permits', {
    subjectId: company.id,
    unitId: unit.id,
    permitNo: `WP-${randomUUID().slice(0, 6)}`,
    type: 'hot_work',
    workDescription: 'Welding on the conveyor frame',
    location: 'Line 1',
    riskMeasures: ['Fire watch', 'Hot work blanket'],
    ...permitWindow,
  });
  expect(permit.status).toBe('draft');
  const permitList = await (
    await admin.fetch(`/hse/work-permits?subjectId=${company.id}`)
  ).json();
  expect(permitList.meta.total).toBe(1);
  expect(permitList.data[0].riskMeasures).toEqual([
    'Fire watch',
    'Hot work blanket',
  ]);
  const duplicatePermit = await send(admin, '/hse/work-permits', {
    subjectId: company.id,
    permitNo: permit.permitNo,
    type: 'hot_work',
    workDescription: 'Duplicate permit number',
    location: 'Line 1',
    riskMeasures: ['Fire watch'],
    ...permitWindow,
  });
  expect(duplicatePermit.status).toBe(409);
  expect(JSON.stringify(await duplicatePermit.json())).toContain(
    'PERMIT_NO_DUPLICATE',
  );
  const invalidPeriod = await send(admin, '/hse/work-permits', {
    subjectId: company.id,
    permitNo: `WP-${randomUUID().slice(0, 6)}`,
    type: 'hot_work',
    workDescription: 'Inverted validity window',
    location: 'Line 1',
    riskMeasures: ['Fire watch'],
    validFrom: permitWindow.validTo,
    validTo: permitWindow.validFrom,
  });
  expect(invalidPeriod.status).toBe(400);
  expect(JSON.stringify(await invalidPeriod.json())).toContain(
    'PERMIT_PERIOD_INVALID',
  );
  // The applicant is the authenticated creator; a body-supplied applicantId
  // must not be able to nominate somebody else for the self-approval check.
  const forgedApplicant = await send(manager.client, '/hse/work-permits', {
    subjectId: company.id,
    permitNo: `WP-${randomUUID().slice(0, 6)}`,
    type: 'hot_work',
    workDescription: 'Applicant must be the creator',
    location: 'Line 1',
    applicantId: approver.id,
    riskMeasures: ['Fire watch'],
    ...permitWindow,
  });
  expect(forgedApplicant.status).toBe(201);
  expect((await forgedApplicant.json()).data.applicantId).toBe(manager.id);
  const submittedPermit = await send(
    admin,
    `/hse/work-permits/${permit.id}/transitions`,
    { version: permit.version, action: 'submit' },
  );
  expect(submittedPermit.status).toBe(200);
  expect((await submittedPermit.json()).data.status).toBe('submitted');
  const selfApproval = await send(
    admin,
    `/hse/work-permits/${permit.id}/transitions`,
    { version: permit.version + 1, action: 'approve' },
  );
  expect(selfApproval.status).toBe(400);
  expect(JSON.stringify(await selfApproval.json())).toContain(
    'PERMIT_SELF_APPROVAL',
  );
  const approvedPermit = await send(
    approver.client,
    `/hse/work-permits/${permit.id}/transitions`,
    { version: permit.version + 1, action: 'approve' },
  );
  expect(approvedPermit.status).toBe(200);
  const approvedPermitJson = (await approvedPermit.json()).data;
  expect(approvedPermitJson.status).toBe('approved');
  expect(approvedPermitJson.approverId).toBe(approver.id);
  expect(approvedPermitJson.approvedAt).toBeTruthy();

  // --- Training records: create, list, reject a foreign person ------------
  const training = await create('/hse/training-records', {
    subjectId: company.id,
    personId: employee.id,
    courseType: 'safety',
    courseName: 'Annual safety induction',
    completedAt: today(),
    score: 92,
  });
  expect(training).toMatchObject({
    subjectId: company.id,
    status: 'completed',
    score: 92,
  });
  const trainingList = await (
    await admin.fetch(`/hse/training-records?subjectId=${company.id}`)
  ).json();
  expect(trainingList.meta.total).toBe(1);
  expect(trainingList.data[0]).toMatchObject({
    id: training.id,
    personName: 'HSE tables employee',
  });
  const foreignPerson = await send(admin, '/hse/training-records', {
    subjectId: company.id,
    personId: otherEmployee.id,
    courseType: 'safety',
    courseName: 'Annual safety induction',
    completedAt: today(),
  });
  expect(foreignPerson.status).toBe(400);
  expect(JSON.stringify(await foreignPerson.json())).toContain(
    'PERSON_NOT_IN_COMPANY',
  );
  const invalidDate = await send(admin, '/hse/training-records', {
    subjectId: company.id,
    personId: employee.id,
    courseType: 'safety',
    courseName: 'Annual safety induction',
    completedAt: '2026/01/01',
  });
  expect(invalidDate.status).toBe(400);

  // --- Actions: create, list, complete, verify ----------------------------
  const action = await create('/hse/actions', {
    subjectId: company.id,
    unitId: unit.id,
    sourceType: 'inspection',
    sourceId: inspection.id,
    description: 'Replace damaged conveyor guard',
    ownerId: employee.id,
    ownerName: 'HSE tables employee',
    dueAt: today(),
  });
  expect(action.status).toBe('open');
  const actionList = await (
    await admin.fetch(`/hse/actions?subjectId=${company.id}`)
  ).json();
  expect(actionList.meta.total).toBe(1);
  expect(actionList.data[0]).toMatchObject({
    id: action.id,
    sourceType: 'inspection',
    sourceId: inspection.id,
    ownerId: employee.id,
  });
  const completedAction = await send(
    admin,
    `/hse/actions/${action.id}/transitions`,
    { version: action.version, action: 'complete' },
  );
  expect(completedAction.status).toBe(200);
  expect((await completedAction.json()).data.status).toBe('completed');
  const selfVerificationByAdmin = await send(
    admin,
    `/hse/actions/${action.id}/transitions`,
    { version: action.version + 1, action: 'verify' },
  );
  expect(selfVerificationByAdmin.status).toBe(400);
  expect(JSON.stringify(await selfVerificationByAdmin.json())).toContain(
    'SELF_VERIFICATION',
  );
  const verifiedAction = await create('/hse/actions', {
    subjectId: company.id,
    sourceType: 'hazard',
    sourceId: randomUUID(),
    description: 'Reanchor the emergency ladder',
    ownerName: 'HSE tables employee',
  });
  const completedByManager = await send(
    manager.client,
    `/hse/actions/${verifiedAction.id}/transitions`,
    { version: verifiedAction.version, action: 'complete' },
  );
  expect(completedByManager.status).toBe(200);
  const verified = await send(
    approver.client,
    `/hse/actions/${verifiedAction.id}/transitions`,
    { version: verifiedAction.version + 1, action: 'verify' },
  );
  expect(verified.status).toBe(200);
  const verifiedJson = (await verified.json()).data;
  expect(verifiedJson.status).toBe('verified');
  expect(verifiedJson.verifiedBy).toBe(approver.id);
  expect(verifiedJson.verifiedAt).toBeTruthy();

  // --- Company scoping ----------------------------------------------------
  const foreignInspectionList = await scopedManager.client.fetch(
    `/hse/inspections?subjectId=${otherCompany.id}`,
  );
  expect(foreignInspectionList.status).toBe(403);
  expect(JSON.stringify(await foreignInspectionList.json())).toContain(
    'HSE_FORBIDDEN',
  );
  const foreignInspection = await send(
    scopedManager.client,
    '/hse/inspections',
    {
      subjectId: otherCompany.id,
      type: 'routine',
      plannedAt: today(),
      checklist: ['Escaped the company boundary'],
    },
  );
  expect(foreignInspection.status).toBe(403);
  const ownInspection = await send(scopedManager.client, '/hse/inspections', {
    subjectId: company.id,
    type: 'special',
    plannedAt: today(),
    checklist: ['Own company inspection'],
  });
  expect(ownInspection.status).toBe(201);
  expect((await ownInspection.json()).data.subjectId).toBe(company.id);
});

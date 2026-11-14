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
import { findUndeclaredApiRoutes } from '@nocobase/app-server/router';
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

test('runs HSE incident, hazard and certificate lifecycles with independent approval', async ({
  testApp,
  request,
}) => {
  expect((await request('/hse/overview')).status).toBe(401);
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
  const subject = await create('/organization/subjects', {
    code: `HSE-${randomUUID().slice(0, 6)}`,
    name: 'HSE test company',
    type: 'group',
  });
  const unit = await create('/organization/units', {
    code: `HSE-U-${randomUUID().slice(0, 6)}`,
    name: 'HSE test line',
    type: 'department',
    subjectId: subject.id,
  });
  const position = await create('/organization/positions', {
    code: `HSE-P-${randomUUID().slice(0, 6)}`,
    name: 'HSE engineer',
    unitId: unit.id,
  });
  const employee = await create('/people/employees', {
    code: 'HSE-E-001',
    name: 'HSE employee',
    subjectId: subject.id,
    data: {},
  });
  const change = await create('/people/changes', {
    code: 'HSE-ENTRY-001',
    name: 'Entry',
    personId: employee.id,
    data: {
      type: 'entry',
      effectiveDate: new Date().toLocaleDateString('en-CA', {
        timeZone: 'Asia/Shanghai',
      }),
      targetSubjectId: subject.id,
      targetPositionId: position.id,
      explanation: 'HSE test hire',
    },
  });
  const firePeople = async (
    kind: string,
    row: { id: string; lifecycleVersion: number },
    transition: string,
    input: unknown = {},
  ) => {
    const r = await send(
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
    const p = await r.json();
    expect(r.status).toBe(200);
    return p.data;
  };
  const pending = await firePeople('changes', change, 'submit');
  const effective = await firePeople('changes', pending, 'approve');
  expect(effective.status).toBe('effective');

  const options = (await (await admin.fetch('/hse/options')).json()).data;
  expect(options.subjects).toContainEqual({
    id: subject.id,
    code: subject.code,
    name: 'HSE test company',
    type: 'group',
  });
  expect(options.units).toContainEqual({
    id: unit.id,
    name: 'HSE test line',
    subjectId: subject.id,
  });
  expect(
    options.employees.find(
      (row: { id: string }) => row.id === employee.id,
    ),
  ).toMatchObject({ name: 'HSE employee', subjectId: subject.id });
  expect(options.permissions).toEqual({
    manage: true,
    approve: true,
    report: true,
  });

  const incident = await create('/hse/incidents', {
    subjectId: subject.id,
    unitId: unit.id,
    occurredAt: new Date().toISOString(),
    type: 'injury',
    severity: 'minor',
    location: 'Magnetic separator',
    description: 'Hand injury while clearing a jam',
    injuryCount: 1,
    lostDays: 2,
  });
  expect(incident.incidentNo).toMatch(/^HSE-INC-\d{8}-[A-F0-9]{4}$/);
  expect(incident.environmentalRelease).toBe(false);
  expect(incident.status).toBe('reported');

  const overview = (await (await admin.fetch('/hse/overview')).json()).data;
  expect(overview.counts.incidentsOpen).toBe(1);
  expect(overview.counts.incidentsLti).toBe(1);

  const invalid = await send(admin, '/hse/incidents', {
    subjectId: subject.id,
    occurredAt: new Date().toISOString(),
    type: 'injury',
    severity: 'minor',
    location: 'Line',
    description: '',
  });
  expect(invalid.status).toBe(400);

  const missingInspectionRef = await send(admin, '/hse/hazards', {
    subjectId: subject.id,
    unitId: unit.id,
    source: 'inspection',
    level: 'general',
    description: 'Missing inspection reference',
    location: 'Line 1',
    discoveredAt: new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Shanghai',
    }),
    ownerName: 'Unassigned',
  });
  expect(missingInspectionRef.status).toBe(400);
  expect(JSON.stringify(await missingInspectionRef.json())).toContain(
    'INSPECTION_REF_REQUIRED',
  );

  const hazard = await create('/hse/hazards', {
    subjectId: subject.id,
    unitId: unit.id,
    source: 'inspection',
    sourceRef: 'INSP-2026-001',
    inspectorId: employee.id,
    level: 'major',
    description: 'Guardrail missing on conveyor',
    location: 'Conveyor 2',
    discoveredAt: new Date().toISOString().slice(0, 10),
    ownerId: employee.id,
    ownerName: 'HSE employee',
    dueAt: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    rectification: 'Install guardrail',
  });
  expect(hazard.sourceRef).toBe('INSP-2026-001');
  expect(hazard.inspectorId).toBe(employee.id);
  expect(hazard.ownerId).toBe(employee.id);
  const overdueOverview = (await (await admin.fetch('/hse/overview')).json())
    .data;
  expect(overdueOverview.counts.hazardsOpen).toBe(1);
  expect(overdueOverview.counts.hazardsOverdue).toBe(1);

  const certificate = await create('/hse/certificates', {
    subjectId: subject.id,
    holderType: 'company',
    holderName: 'HSE test company',
    certType: 'pollution',
    certNo: 'PWL-2026-001',
    expiresAt: new Date(Date.now() + 30 * 86_400_000)
      .toISOString()
      .slice(0, 10),
    authority: 'Eco Environment Bureau',
  });
  expect(certificate.status).toBe('expiring');
  const operations = (
    await (await admin.fetch('/hse/operations-summary')).json()
  ).data;
  expect(operations.metrics.certificatesExpiring90).toBe(1);
  expect(operations.metrics.incidentsOpen).toBe(1);

  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const authz = testApp.application.container.resolve(authorizationToken);
  const makeUser = async (name: string, actions: string[]) => {
    const email = `${randomUUID()}@example.test`;
    const password = randomUUID();
    const account = await users.create({ name, email, password });
    const role = await authz.permissionSets.create({
      key: `hse-${randomUUID()}`,
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
  const manager = await makeUser('HSE manager', ['read', 'manage', 'readAll']);
  const approver = await makeUser('HSE approver', [
    'read',
    'approve',
    'readAll',
  ]);
  const managerOptions = (
    await (await manager.client.fetch('/hse/options')).json()
  ).data;
  expect(managerOptions.permissions).toEqual({
    manage: true,
    approve: false,
    report: false,
  });
  const approverOptions = (
    await (await approver.client.fetch('/hse/options')).json()
  ).data;
  expect(approverOptions.permissions).toEqual({
    manage: false,
    approve: true,
    report: false,
  });

  const investigated = await send(
    manager.client,
    `/hse/incidents/${incident.id}/transitions`,
    { version: incident.version, action: 'investigate' },
  );
  expect(investigated.status).toBe(200);
  const investigating = (await investigated.json()).data;
  expect(investigating.status).toBe('investigating');
  expect(investigating.investigatorId).toBe(manager.id);

  const rectifyNoOwner = await send(
    manager.client,
    `/hse/incidents/${incident.id}/transitions`,
    {
      version: investigating.version,
      action: 'rectify',
      rootCause: 'Guard was removed during maintenance',
    },
  );
  expect(rectifyNoOwner.status).toBe(400);
  expect(JSON.stringify(await rectifyNoOwner.json())).toContain(
    'OWNER_REQUIRED',
  );

  const rectifyNoDue = await send(
    manager.client,
    `/hse/incidents/${incident.id}/transitions`,
    {
      version: investigating.version,
      action: 'rectify',
      rootCause: 'Guard was removed during maintenance',
      ownerId: employee.id,
    },
  );
  expect(rectifyNoDue.status).toBe(400);
  expect(JSON.stringify(await rectifyNoDue.json())).toContain('DUE_REQUIRED');

  const rectified = await send(
    manager.client,
    `/hse/incidents/${incident.id}/transitions`,
    {
      version: investigating.version,
      action: 'rectify',
      rootCause: 'Guard was removed during maintenance',
      ownerId: employee.id,
      dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      actions: 'Restore interlock and retrain the crew',
    },
  );
  expect(rectified.status).toBe(200);
  const rectifying = (await rectified.json()).data;
  expect(rectifying.status).toBe('rectifying');
  expect(rectifying.ownerId).toBe(employee.id);

  const submitNoActions = await send(
    manager.client,
    `/hse/incidents/${incident.id}/transitions`,
    { version: rectifying.version, action: 'submit', actions: '' },
  );
  expect(submitNoActions.status).toBe(400);
  expect(JSON.stringify(await submitNoActions.json())).toContain(
    'ACTIONS_REQUIRED',
  );

  const submitted = await send(
    manager.client,
    `/hse/incidents/${incident.id}/transitions`,
    {
      version: rectifying.version,
      action: 'submit',
      actions: 'Interlock restored and crew retrained',
    },
  );
  expect(submitted.status).toBe(200);
  const verifying = (await submitted.json()).data;
  expect(verifying.status).toBe('verifying');
  expect(verifying.rectifiedBy).toBe(manager.id);

  // While an incident is awaiting approval, a direct PATCH would let the
  // submitter rewrite the evidence under the approver.
  const verifyingEdit = await send(
    manager.client,
    `/hse/incidents/${incident.id}`,
    { version: verifying.version, severity: 'major' },
    'PATCH',
  );
  expect(verifyingEdit.status).toBe(400);
  expect(JSON.stringify(await verifyingEdit.json())).toContain(
    'INCIDENT_STATE',
  );

  const missingOwnerIncident = await create('/hse/incidents', {
    subjectId: subject.id,
    unitId: unit.id,
    occurredAt: new Date().toISOString(),
    type: 'near_miss',
    severity: 'minor',
    location: 'Packing line',
    description: 'Pallet fell without injury',
  });
  const missingOwner = await send(
    manager.client,
    `/hse/incidents/${missingOwnerIncident.id}`,
    { version: missingOwnerIncident.version, ownerId: randomUUID() },
    'PATCH',
  );
  expect(missingOwner.status).toBe(400);
  expect(JSON.stringify(await missingOwner.json())).toContain(
    'OWNER_NOT_FOUND',
  );

  const managerVerify = await send(
    manager.client,
    `/hse/incidents/${incident.id}/transitions`,
    { version: verifying.version, action: 'verify', note: 'Checked' },
  );
  expect(managerVerify.status).toBe(403);

  const returned = await send(
    approver.client,
    `/hse/incidents/${incident.id}/transitions`,
    {
      version: verifying.version,
      action: 'return',
      note: 'Add training records',
    },
  );
  expect(returned.status).toBe(200);
  const returnedIncident = (await returned.json()).data;
  expect(returnedIncident.status).toBe('rectifying');
  expect(returnedIncident.rectifiedBy).toBeNull();

  const rerectified = await send(
    manager.client,
    `/hse/incidents/${incident.id}/transitions`,
    {
      version: returnedIncident.version,
      action: 'rectify',
      rootCause: 'Guard was removed during maintenance; training missing',
    },
  );
  expect(rerectified.status).toBe(200);
  const rerectifying = (await rerectified.json()).data;
  expect(rerectifying.status).toBe('rectifying');
  expect(rerectifying.rootCause).toBe(
    'Guard was removed during maintenance; training missing',
  );

  const resubmitted = await send(
    manager.client,
    `/hse/incidents/${incident.id}/transitions`,
    {
      version: rerectifying.version,
      action: 'submit',
      actions: 'Interlock restored, training recorded',
    },
  );
  expect(resubmitted.status).toBe(200);
  const reverifying = (await resubmitted.json()).data;

  const closed = await send(
    approver.client,
    `/hse/incidents/${incident.id}/transitions`,
    { version: reverifying.version, action: 'verify', note: 'Accepted' },
  );
  expect(closed.status).toBe(200);
  const closedIncident = (await closed.json()).data;
  expect(closedIncident.status).toBe('closed');
  expect(closedIncident.verifiedBy).toBe(approver.id);
  expect(closedIncident.closedBy).toBe(approver.id);
  expect(closedIncident.history.at(-1)).toMatchObject({
    action: 'verify',
    from: 'verifying',
    to: 'closed',
  });

  const closedEdit = await send(
    admin,
    `/hse/incidents/${incident.id}`,
    { version: closedIncident.version, severity: 'major' },
    'PATCH',
  );
  expect(closedEdit.status).toBe(400);

  const startNoOwner = await send(admin, `/hse/hazards/${hazard.id}/transitions`, {
    version: hazard.version,
    action: 'startRectification',
  });
  // ownerId/dueAt were carried by the row, so a bare start still succeeds;
  // the guard is exercised on rows without them (see below).
  expect(startNoOwner.status).toBe(200);
  const started = (await startNoOwner.json()).data;
  expect(started.status).toBe('rectifying');
  expect(started.ownerId).toBe(employee.id);

  const orphanHazard = await create('/hse/hazards', {
    subjectId: subject.id,
    unitId: unit.id,
    source: 'inspection',
    sourceRef: 'INSP-2026-002',
    level: 'general',
    description: 'Loose cable in corridor',
    location: 'Corridor',
    discoveredAt: new Date().toISOString().slice(0, 10),
    ownerName: 'Unassigned',
  });
  const orphanStart = await send(
    admin,
    `/hse/hazards/${orphanHazard.id}/transitions`,
    { version: orphanHazard.version, action: 'startRectification' },
  );
  expect(orphanStart.status).toBe(400);
  expect(JSON.stringify(await orphanStart.json())).toContain('OWNER_REQUIRED');

  const orphanStarted = await send(
    admin,
    `/hse/hazards/${orphanHazard.id}/transitions`,
    {
      version: orphanHazard.version,
      action: 'startRectification',
      ownerId: employee.id,
      dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      rectification: 'Fasten the cable',
    },
  );
  expect(orphanStarted.status).toBe(200);
  const orphanSubmitted = await send(
    admin,
    `/hse/hazards/${orphanHazard.id}/transitions`,
    {
      version: (await orphanStarted.json()).data.version,
      action: 'submitVerification',
      rectification: 'Cable fastened',
    },
  );
  expect(orphanSubmitted.status).toBe(200);
  const orphanVerified = await send(
    approver.client,
    `/hse/hazards/${orphanHazard.id}/transitions`,
    {
      version: (await orphanSubmitted.json()).data.version,
      action: 'verify',
      note: 'Checked',
    },
  );
  expect(orphanVerified.status).toBe(200);

  const submit = await send(admin, `/hse/hazards/${hazard.id}/transitions`, {
    version: started.version,
    action: 'submitVerification',
    rectification: 'Guardrail reinstalled and inspected',
  });
  expect(submit.status).toBe(200);
  const verifyingHazard = (await submit.json()).data;
  expect(verifyingHazard.status).toBe('verifying');
  expect(typeof verifyingHazard.rectifiedBy).toBe('string');

  const selfVerify = await send(
    admin,
    `/hse/hazards/${hazard.id}/transitions`,
    { version: verifyingHazard.version, action: 'verify' },
  );
  expect(selfVerify.status).toBe(400);
  expect(JSON.stringify(await selfVerify.json())).toContain(
    'SELF_VERIFICATION',
  );

  const returnedStart = await send(
    approver.client,
    `/hse/hazards/${hazard.id}/transitions`,
    {
      version: verifyingHazard.version,
      action: 'return',
      note: 'Add photo evidence',
    },
  );
  expect(returnedStart.status).toBe(200);
  const returnedHazard = (await returnedStart.json()).data;
  expect(returnedHazard.status).toBe('rectifying');
  expect(returnedHazard.rectifiedBy).toBeNull();

  const resubmittedHazardRequest = await send(
    admin,
    `/hse/hazards/${hazard.id}/transitions`,
    {
      version: returnedHazard.version,
      action: 'submitVerification',
      rectification: 'Guardrail reinstalled, photo uploaded',
    },
  );
  expect(resubmittedHazardRequest.status).toBe(200);
  const resubmittedHazard = (await resubmittedHazardRequest.json()).data;

  const verified = await send(
    approver.client,
    `/hse/hazards/${hazard.id}/transitions`,
    {
      version: resubmittedHazard.version,
      action: 'verify',
      note: 'Site checked',
    },
  );
  expect(verified.status).toBe(200);
  const closedHazard = (await verified.json()).data;
  expect(closedHazard.status).toBe('closed');
  expect(closedHazard.verifiedBy).toBe(approver.id);
  const closedOverview = (await (await admin.fetch('/hse/overview')).json())
    .data;
  expect(closedOverview.counts.hazardsOpen).toBe(0);
  expect(closedOverview.counts.hazardsOverdue).toBe(0);

  const directHazardPatch = await send(
    admin,
    `/hse/hazards/${hazard.id}`,
    { version: closedHazard.version, status: 'open' },
    'PATCH',
  );
  expect(directHazardPatch.status).toBe(400);

  const renewed = await send(
    manager.client,
    `/hse/certificates/${certificate.id}/transitions`,
    {
      version: certificate.version,
      action: 'renew',
      expiresAt: new Date(Date.now() + 365 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      note: 'Annual renewal',
    },
  );
  expect(renewed.status).toBe(200);
  const renewedCertificate = (await renewed.json()).data;
  expect(renewedCertificate.status).toBe('active');

  const managerRevoke = await send(
    manager.client,
    `/hse/certificates/${certificate.id}/transitions`,
    {
      version: renewedCertificate.version,
      action: 'revoke',
      note: 'Not allowed',
    },
  );
  expect(managerRevoke.status).toBe(403);

  const revoked = await send(
    approver.client,
    `/hse/certificates/${certificate.id}/transitions`,
    {
      version: renewedCertificate.version,
      action: 'revoke',
      note: 'Authority withdrew the permit',
    },
  );
  expect(revoked.status).toBe(200);
  const revokedCertificate = (await revoked.json()).data;
  expect(revokedCertificate.status).toBe('revoked');
  expect(revokedCertificate.revokedBy).toBe(approver.id);

  const reinstated = await send(
    approver.client,
    `/hse/certificates/${certificate.id}/transitions`,
    {
      version: revokedCertificate.version,
      action: 'reinstate',
      note: 'Permit restored after appeal',
    },
  );
  expect(reinstated.status).toBe(200);
  const reinstatedCertificate = (await reinstated.json()).data;
  expect(reinstatedCertificate.status).toBe('active');

  const activeDatePatch = await send(
    manager.client,
    `/hse/certificates/${certificate.id}`,
    {
      version: reinstatedCertificate.version,
      expiresAt: new Date(Date.now() + 730 * 86_400_000)
        .toISOString()
        .slice(0, 10),
    },
    'PATCH',
  );
  expect(activeDatePatch.status).toBe(400);
  expect(JSON.stringify(await activeDatePatch.json())).toContain(
    'CERTIFICATE_ACTIVE',
  );

  // An already-expired certificate is corrected through PATCH rather than the
  // renew flow: creating it with a past expiry is enough to reach that state.
  const expiredCertificate = await create('/hse/certificates', {
    subjectId: subject.id,
    holderType: 'company',
    holderName: 'HSE test company',
    certType: 'safety',
    certNo: `CERT-EXP-${randomUUID().slice(0, 8)}`,
    issuedAt: new Date(Date.now() - 400 * 86_400_000)
      .toISOString()
      .slice(0, 10),
    expiresAt: new Date(Date.now() - 10 * 86_400_000)
      .toISOString()
      .slice(0, 10),
    authority: 'Bureau',
  });
  expect(expiredCertificate.status).toBe('expired');
  const expiredDatePatch = await send(
    manager.client,
    `/hse/certificates/${expiredCertificate.id}`,
    {
      version: expiredCertificate.version,
      issuedAt: new Date(Date.now() - 30 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      expiresAt: new Date(Date.now() + 400 * 86_400_000)
        .toISOString()
        .slice(0, 10),
    },
    'PATCH',
  );
  expect(expiredDatePatch.status).toBe(200);
  const correctedExpired = (await expiredDatePatch.json()).data;
  expect(correctedExpired.status).toBe('active');

  const personHolderMissing = await send(
    manager.client,
    '/hse/certificates',
    {
      subjectId: subject.id,
      holderType: 'person',
      holderName: 'Nobody',
      certType: 'special_operation',
      certNo: `CERT-${randomUUID().slice(0, 8)}`,
      expiresAt: new Date(Date.now() + 365 * 86_400_000)
        .toISOString()
        .slice(0, 10),
    },
  );
  expect(personHolderMissing.status).toBe(400);
  expect(JSON.stringify(await personHolderMissing.json())).toContain(
    'HOLDER_REQUIRED',
  );

  const personCertificate = await send(
    manager.client,
    '/hse/certificates',
    {
      subjectId: subject.id,
      holderType: 'person',
      holderId: employee.id,
      holderName: employee.name,
      certType: 'special_operation',
      certNo: `CERT-P-${randomUUID().slice(0, 8)}`,
      expiresAt: new Date(Date.now() + 365 * 86_400_000)
        .toISOString()
        .slice(0, 10),
    },
  );
  expect(personCertificate.status).toBe(201);
  const createdPersonCertificate = (await personCertificate.json()).data;
  expect(createdPersonCertificate.holderId).toBe(employee.id);
  expect(createdPersonCertificate.holderType).toBe('person');

  const firstOperationCertificate = await send(
    manager.client,
    '/hse/certificates',
    {
      subjectId: subject.id,
      holderType: 'company',
      holderName: subject.name,
      certType: 'special_operation',
      certNo: 'CERT-OP-1',
      expiresAt: new Date(Date.now() + 365 * 86_400_000)
        .toISOString()
        .slice(0, 10),
    },
  );
  expect(firstOperationCertificate.status).toBe(201);

  const duplicateCertificate = await send(
    manager.client,
    '/hse/certificates',
    {
      subjectId: subject.id,
      holderType: 'company',
      holderName: subject.name,
      certType: 'special_operation',
      certNo: 'CERT-DUP-1',
      expiresAt: new Date(Date.now() + 365 * 86_400_000)
        .toISOString()
        .slice(0, 10),
    },
  );
  expect(duplicateCertificate.status).toBe(409);
  expect(JSON.stringify(await duplicateCertificate.json())).toContain(
    'CERTIFICATE_DUPLICATE',
  );

  const expiringSoon = await send(manager.client, '/hse/certificates', {
    subjectId: subject.id,
    holderType: 'company',
    holderName: subject.name,
    certType: 'fire',
    certNo: `CERT-FIRE-${randomUUID().slice(0, 8)}`,
    expiresAt: new Date(Date.now() + 60 * 86_400_000)
      .toISOString()
      .slice(0, 10),
  });
  expect(expiringSoon.status).toBe(201);

  const scopedOverview = (
    await (await admin.fetch(`/hse/overview?subjectId=${subject.id}`)).json()
  ).data;
  expect(scopedOverview.scope).toBe('company');
  expect(scopedOverview.horizonDays).toBe(90);
  expect(
    scopedOverview.counts.certificatesExpiring90,
  ).toBeGreaterThanOrEqual(1);

  const narrowOverview = (
    await (await admin.fetch('/hse/overview?horizonDays=30')).json()
  ).data;
  expect(narrowOverview.horizonDays).toBe(30);
  expect(narrowOverview.counts.certificatesExpiring90).toBe(0);

  expect((await admin.fetch('/hse/overview?horizonDays=0')).status).toBe(400);

  expect(findUndeclaredApiRoutes(testApp.application)).toEqual([]);

  const viewerPassword = randomUUID();
  const viewerEmail = `hse-viewer-${randomUUID()}@example.test`;
  const viewer = await users.create({
    name: 'HSE group viewer',
    email: viewerEmail,
    password: viewerPassword,
  });
  const client = await signIn(testApp, {
    email: viewerEmail,
    password: viewerPassword,
  });
  expect((await client.fetch('/hse/overview')).status).toBe(403);
  const assignment = await authz.permissionSets.assign({
    permissionSet: 'hse-group-viewer',
    subject: { type: 'user', id: viewer.id },
  });
  expect((await client.fetch('/hse/overview')).status).toBe(200);
  const reported = await client.fetch('/hse/incidents', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
    body: JSON.stringify({
      subjectId: subject.id,
      occurredAt: new Date().toISOString(),
      type: 'injury',
      severity: 'minor',
      location: 'Line',
      description: 'Reported by viewer',
    }),
  });
  // A read-all viewer has no company assignment: creating records is
  // rejected even with the report action (reporters are scoped to the
  // company of their own assignment).
  expect(reported.status).toBe(403);
  expect(JSON.stringify(await reported.json())).toContain('HSE_FORBIDDEN');
  await authz.permissionSets.revoke(assignment.id);
  expect((await client.fetch('/hse/overview')).status).toBe(403);

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR6kAAAAASUVORK5CYII=',
    'base64',
  );
  const uploadForm = new FormData();
  uploadForm.set('file', new File([png], '现场.png', { type: 'image/png' }));
  const upload = await manager.client.fetch(
    `/hseFiles/uploadOne?scope=incident&scopeId=${incident.id}`,
    {
      method: 'POST',
      headers: { origin: 'http://localhost' },
      body: uploadForm,
    },
  );
  expect(upload.status).toBe(201);
  const uploaded = (await upload.json()).data.record;
  expect(uploaded.contentUrl).toContain('/uploads/hseFiles/');

  const listed = await send(
    manager.client,
    `/hseFiles/findMany?scope=incident&scopeId=${incident.id}`,
    { limit: 20 },
  );
  expect(listed.status).toBe(200);
  const listedRows = (await listed.json()).data;
  expect(listedRows).toHaveLength(1);
  expect(listedRows[0]).toMatchObject({
    id: uploaded.id,
    filename: '现场.png',
    ext: 'png',
  });
  expect(listedRows[0].disk).toBeUndefined();
  expect(listedRows[0].key).toBeUndefined();

  const content = await testApp.fetch(
    new Request(new URL(uploaded.contentUrl, 'http://localhost'), {
      headers: { cookie: manager.client.cookie },
    }),
  );
  expect(content.status).toBe(200);
  expect(content.headers.get('Cache-Control')).toBe('private, no-store');
  expect(Buffer.from(await content.arrayBuffer())).toEqual(png);

  const anonymousContent = await testApp.fetch(
    new Request(new URL(uploaded.contentUrl, 'http://localhost')),
  );
  expect(anonymousContent.status).toBe(401);

  const outsideViewerForm = new FormData();
  outsideViewerForm.set(
    'file',
    new File([png], 'viewer.png', { type: 'image/png' }),
  );
  const viewerUpload = await client.fetch(
    `/hseFiles/uploadOne?scope=incident&scopeId=${incident.id}`,
    {
      method: 'POST',
      headers: { origin: 'http://localhost' },
      body: outsideViewerForm,
    },
  );
  expect(viewerUpload.status).toBe(403);

  const rejectedForm = new FormData();
  rejectedForm.set(
    'file',
    new File(['not an image'], 'notes.txt', { type: 'text/plain' }),
  );
  const rejected = await manager.client.fetch(
    `/hseFiles/uploadOne?scope=incident&scopeId=${incident.id}`,
    {
      method: 'POST',
      headers: { origin: 'http://localhost' },
      body: rejectedForm,
    },
  );
  expect(rejected.status).toBe(415);

  const reporter = await makeUser('HSE reporter', [
    'read',
    'report',
    'readAll',
  ]);
  const reporterOptions = (
    await (await reporter.client.fetch('/hse/options')).json()
  ).data;
  expect(reporterOptions.permissions).toEqual({
    manage: false,
    approve: false,
    report: true,
  });
  // Give the reporter a company assignment: report creation must then be
  // allowed in their own company but rejected for any other company.
  const reporterPerson = await create('/people/employees', {
    code: `HSE-E-R-${randomUUID().slice(0, 6)}`,
    name: 'HSE reporter person',
    subjectId: subject.id,
    data: { accountId: reporter.id },
  });
  const reporterChange = await create('/people/changes', {
    code: `HSE-ENTRY-R-${randomUUID().slice(0, 6)}`,
    name: 'Entry',
    personId: reporterPerson.id,
    data: {
      type: 'entry',
      effectiveDate: new Date().toLocaleDateString('en-CA', {
        timeZone: 'Asia/Shanghai',
      }),
      targetSubjectId: subject.id,
      targetPositionId: position.id,
      explanation: 'HSE test reporter hire',
    },
  });
  const reporterPendingChange = await firePeople(
    'changes',
    reporterChange,
    'submit',
  );
  await firePeople('changes', reporterPendingChange, 'approve');
  const foreignIncident = await send(
    reporter.client,
    '/hse/incidents',
    {
      subjectId: '00000000-0000-4000-8000-000000000000',
      occurredAt: new Date().toISOString(),
      type: 'injury',
      severity: 'minor',
      location: 'Line',
      description: 'Reported for a foreign company',
    },
    'POST',
  );
  expect(foreignIncident.status).toBe(403);
  expect(JSON.stringify(await foreignIncident.json())).toContain(
    'HSE_FORBIDDEN',
  );
  const reporterIncident = await send(
    reporter.client,
    '/hse/incidents',
    {
      subjectId: subject.id,
      occurredAt: new Date().toISOString(),
      type: 'injury',
      severity: 'minor',
      location: 'Line',
      description: 'Reported by reporter role',
    },
    'POST',
  );
  expect(reporterIncident.status).toBe(201);
  const reporterHazard = await send(
    reporter.client,
    '/hse/hazards',
    {
      subjectId: subject.id,
      unitId: unit.id,
      source: 'inspection',
      sourceRef: 'INSP-2026-003',
      level: 'general',
      description: 'Slippery floor near gate',
      location: 'Gate',
      discoveredAt: new Date().toISOString().slice(0, 10),
      ownerName: 'To assign',
    },
    'POST',
  );
  expect(reporterHazard.status).toBe(201);
  const reporterIncidentJson = (await reporterIncident.json()).data;
  const reporterTransition = await send(
    reporter.client,
    `/hse/incidents/${reporterIncidentJson.id}/transitions`,
    { version: reporterIncidentJson.version, action: 'investigate' },
  );
  expect(reporterTransition.status).toBe(403);
  const reporterCertificate = await send(
    reporter.client,
    '/hse/certificates',
    {
      subjectId: subject.id,
      holderType: 'company',
      holderName: 'HSE test company',
      certType: 'pollution',
      certNo: 'PWL-REPORT-001',
      expiresAt: new Date(Date.now() + 90 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      authority: 'Bureau',
    },
    'POST',
  );
  expect(reporterCertificate.status).toBe(403);
});

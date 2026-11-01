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
  expect(options.permissions).toEqual({ manage: true, approve: true });

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

  const hazard = await create('/hse/hazards', {
    subjectId: subject.id,
    unitId: unit.id,
    source: 'inspection',
    level: 'major',
    description: 'Guardrail missing on conveyor',
    location: 'Conveyor 2',
    discoveredAt: new Date().toISOString().slice(0, 10),
    ownerName: 'Line supervisor',
    dueAt: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    rectification: 'Install guardrail',
  });
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
  expect(managerOptions.permissions).toEqual({ manage: true, approve: false });
  const approverOptions = (
    await (await approver.client.fetch('/hse/options')).json()
  ).data;
  expect(approverOptions.permissions).toEqual({ manage: false, approve: true });

  const investigated = await send(
    manager.client,
    `/hse/incidents/${incident.id}/transitions`,
    { version: incident.version, action: 'investigate' },
  );
  expect(investigated.status).toBe(200);
  const investigating = (await investigated.json()).data;
  expect(investigating.status).toBe('investigating');
  expect(investigating.investigatorId).toBe(manager.id);

  const rectified = await send(
    manager.client,
    `/hse/incidents/${incident.id}/transitions`,
    {
      version: investigating.version,
      action: 'rectify',
      rootCause: 'Guard was removed during maintenance',
      actions: 'Restore interlock and retrain the crew',
    },
  );
  expect(rectified.status).toBe(200);
  const rectifying = (await rectified.json()).data;
  expect(rectifying.status).toBe('rectifying');

  const managerClose = await send(
    manager.client,
    `/hse/incidents/${incident.id}/transitions`,
    { version: rectifying.version, action: 'close' },
  );
  expect(managerClose.status).toBe(403);

  const closed = await send(
    approver.client,
    `/hse/incidents/${incident.id}/transitions`,
    { version: rectifying.version, action: 'close', note: 'Accepted' },
  );
  expect(closed.status).toBe(200);
  const closedIncident = (await closed.json()).data;
  expect(closedIncident.status).toBe('closed');
  expect(closedIncident.closedBy).toBe(approver.id);
  expect(closedIncident.history.at(-1)).toMatchObject({
    action: 'close',
    from: 'rectifying',
    to: 'closed',
  });

  const closedEdit = await send(
    admin,
    `/hse/incidents/${incident.id}`,
    { version: closedIncident.version, severity: 'major' },
    'PATCH',
  );
  expect(closedEdit.status).toBe(400);

  const start = await send(admin, `/hse/hazards/${hazard.id}/transitions`, {
    version: hazard.version,
    action: 'startRectification',
  });
  expect(start.status).toBe(200);
  const started = (await start.json()).data;
  const submit = await send(admin, `/hse/hazards/${hazard.id}/transitions`, {
    version: started.version,
    action: 'submitVerification',
    rectification: 'Guardrail reinstalled and inspected',
  });
  expect(submit.status).toBe(200);
  const verifying = (await submit.json()).data;
  expect(verifying.status).toBe('verifying');
  expect(typeof verifying.rectifiedBy).toBe('string');

  const selfVerify = await send(
    admin,
    `/hse/hazards/${hazard.id}/transitions`,
    { version: verifying.version, action: 'verify' },
  );
  expect(selfVerify.status).toBe(400);
  expect(JSON.stringify(await selfVerify.json())).toContain(
    'SELF_VERIFICATION',
  );

  const returned = await send(
    approver.client,
    `/hse/hazards/${hazard.id}/transitions`,
    {
      version: verifying.version,
      action: 'return',
      note: 'Add photo evidence',
    },
  );
  expect(returned.status).toBe(200);
  const returnedHazard = (await returned.json()).data;
  expect(returnedHazard.status).toBe('rectifying');
  expect(returnedHazard.rectifiedBy).toBeNull();

  const resubmitted = await send(
    admin,
    `/hse/hazards/${hazard.id}/transitions`,
    {
      version: returnedHazard.version,
      action: 'submitVerification',
      rectification: 'Guardrail reinstalled, photo uploaded',
    },
  );
  expect(resubmitted.status).toBe(200);
  const resubmittedHazard = (await resubmitted.json()).data;

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
  expect((await reinstated.json()).data.status).toBe('active');

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
  const denied = await client.fetch('/hse/incidents', {
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
      description: 'Attempted write',
    }),
  });
  expect(denied.status).toBe(403);
  await authz.permissionSets.revoke(assignment.id);
  expect((await client.fetch('/hse/overview')).status).toBe(403);
});

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

type Client = Awaited<ReturnType<typeof signIn>>;
const json = (body: unknown, method = 'POST') => ({
  method,
  headers: {
    'content-type': 'application/json',
    origin: 'http://localhost',
    'Idempotency-Key': `${Date.now()}.${randomUUID()}`,
  },
  body: JSON.stringify(body),
});

test('supplier identity field policies redact hidden columns and reject hidden writes', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const authz = testApp.application.container.resolve(authorizationToken);
  const send = async (
    client: Client,
    path: string,
    body: unknown,
    method = 'POST',
  ) => client.fetch(path, json(body, method));

  const companyResponse = await send(admin, '/organization/subjects', {
    code: `FP-SUP-${randomUUID().slice(0, 6)}`,
    name: 'Supplier field policy company',
    type: 'group',
  });
  expect(companyResponse.status).toBe(201);
  const company = (await companyResponse.json()).data as { id: string };

  const registrationCode = `9131${randomUUID().slice(0, 8)}`.toUpperCase();
  const createdResponse = await send(admin, '/procurement/suppliers', {
    subjectId: company.id,
    code: `SUP-${randomUUID().slice(0, 8)}`,
    name: 'Policy supplier',
    registrationCode,
    notes: '',
    requestKey: randomUUID(),
  });
  expect(createdResponse.status).toBe(201);
  const supplier = (await createdResponse.json()).data as {
    id: string;
    partnerId: string;
    identity: { revision: number; code: string; name: string };
  };
  expect(supplier.identity).toHaveProperty(
    'registrationCode',
    registrationCode,
  );

  const email = `${randomUUID()}@example.test`;
  const password = randomUUID();
  const account = await users.create({
    name: 'Supplier policy manager',
    email,
    password,
  });
  const role = await authz.permissionSets.create({
    key: `fp-supplier-${randomUUID()}`,
    title: 'Supplier policy set',
    grants: [
      {
        resource: { type: 'composite', id: 'procurement.suppliers' },
        actions: ['read', 'updateIdentity', 'updateRelationship'].map(
          (action) => ({
            action,
            policy: {
              type: 'composite',
              scopes: {
                businessPartners: 'allRecords',
                orgRegions: 'allRecords',
                partnerRolePolicies: 'allRecords',
                partnerRegionScopes: 'allRecords',
                partnerCompanyScopes: 'allRecords',
                partnerSubjectSettings: {
                  type: 'recordAccess',
                  key: 'procurement.supplierCompanies',
                  params: { subjectIds: [company.id] },
                },
                supplyChainAudit: {
                  type: 'recordAccess',
                  key: 'procurement.supplierCompanies',
                  params: { subjectIds: [company.id] },
                },
                orgSubjects: {
                  type: 'recordAccess',
                  key: 'supplyChain.subjects',
                  params: { subjectIds: [company.id] },
                },
              },
            },
          }),
        ),
      },
    ],
  });
  await authz.permissionSets.assign({
    permissionSet: role.key,
    subject: { type: 'user', id: account.id },
  });
  const client = await signIn(testApp, { email, password });

  const saved = await admin.fetch(
    '/field-policies',
    json(
      {
        permissionSetKey: role.key,
        requestKey: randomUUID(),
        policies: [
          {
            resource: 'procurement.supplier.base',
            field: 'code',
            access: 'write',
          },
          {
            resource: 'procurement.supplier.base',
            field: 'name',
            access: 'write',
          },
          {
            resource: 'procurement.supplier.base',
            field: 'registrationCode',
            access: 'hidden',
          },
          {
            resource: 'procurement.supplier.base',
            field: 'status',
            access: 'write',
          },
          {
            resource: 'procurement.supplier.identity',
            field: 'code',
            access: 'write',
          },
          {
            resource: 'procurement.supplier.identity',
            field: 'name',
            access: 'write',
          },
          {
            resource: 'procurement.supplier.identity',
            field: 'registrationCode',
            access: 'hidden',
          },
          {
            resource: 'procurement.supplier.identity',
            field: 'status',
            access: 'write',
          },
        ],
      },
      'PUT',
    ),
  );
  expect(saved.status).toBe(200);

  const list = await client.fetch(
    `/procurement/suppliers?subjectId=${company.id}`,
  );
  expect(list.status).toBe(200);
  const row = (await list.json()).data.find(
    (candidate: { id: string }) => candidate.id === supplier.id,
  );
  expect(row).toBeTruthy();
  expect(row.identity).not.toHaveProperty('registrationCode');
  expect(row.identity.code).toBe(supplier.identity.code);

  const identities = await client.fetch('/procurement/supplierIdentities');
  expect(identities.status).toBe(200);
  const identityRow = (await identities.json()).data.find(
    (candidate: { id: string }) => candidate.id === supplier.partnerId,
  );
  expect(identityRow).toBeTruthy();
  expect(identityRow).not.toHaveProperty('registrationCode');
  expect(identityRow.name).toBe('Policy supplier');

  const hiddenWrite = await send(
    client,
    `/procurement/supplierIdentities/${supplier.partnerId}`,
    {
      version: supplier.identity.revision,
      requestKey: randomUUID(),
      reason: 'Hidden write attempt',
      code: supplier.identity.code,
      name: supplier.identity.name,
      registrationCode: 'REG-CHANGED',
    },
    'PATCH',
  );
  expect(hiddenWrite.status).toBe(403);
  expect((await hiddenWrite.json()).error.reason).toBe('FIELD_NOT_WRITABLE');

  const visibleWrite = await send(
    client,
    `/procurement/supplierIdentities/${supplier.partnerId}`,
    {
      version: supplier.identity.revision,
      requestKey: randomUUID(),
      reason: 'Rename shared identity',
      code: supplier.identity.code,
      name: 'Renamed supplier',
    },
    'PATCH',
  );
  expect(visibleWrite.status).toBe(200);
  const renamed = (await visibleWrite.json()).data;
  expect(renamed.name).toBe('Renamed supplier');
  expect(renamed).not.toHaveProperty('registrationCode');

  const createHidden = await send(client, '/procurement/suppliers', {
    subjectId: company.id,
    code: `SUP-${randomUUID().slice(0, 8)}`,
    name: 'Hidden create',
    registrationCode: 'REG-CREATE',
    notes: '',
    requestKey: randomUUID(),
  });
  expect(createHidden.status).toBe(403);
});

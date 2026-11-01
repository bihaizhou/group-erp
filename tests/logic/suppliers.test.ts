// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import {
  apiDocsToken,
  findUndeclaredApiRoutes,
  findApiDocumentSchemaProblems,
} from '@nocobase/app-server/router';
import { createStandaloneServer } from '../../server/standalone.js';
import { supplierServiceToken } from '../../server/providers/procurement.js';
import { recordLifecycleToken } from '../../server/providers/record-lifecycle.js';
import {
  supplierActions,
  type SupplierAction,
} from '../../server/providers/supplier-resources.js';
import type { MaterialPolicies } from '../../server/providers/material-service.js';
import supplierDefaults from '../../database/main/seeds/202610170004_procurement_supplier_defaults.js';
import { supplierView } from '../../server/providers/supplier-model.js';

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
type Session = Awaited<ReturnType<typeof signIn>>;
type TestApp = Parameters<typeof signIn>[0];
const send = (session: Session, path: string, body: unknown, method = 'POST') =>
  session.fetch(path, {
    method,
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  });
const mutation = (version: number) => ({
  version,
  requestKey: randomUUID(),
  reason: 'Isolated supplier verification',
});
async function fixture(testApp: TestApp) {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const authz = testApp.application.container.resolve(authorizationToken);
  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const user = await users.create({
    name: 'Supplier verifier',
    email: `${randomUUID()}@example.test`,
    password: randomUUID(),
  });
  // Passwords are isolated fixture values, never a live user's credentials.
  const password = randomUUID();
  const memberUser = await users.create({
    name: 'Company supplier maintainer',
    email: `${randomUUID()}@example.test`,
    password,
  });
  const member = await signIn(testApp, { email: memberUser.email!, password });
  const company = async () => {
    const r = await send(admin, '/organization/subjects', {
      code: randomUUID(),
      name: 'Isolated supplier company',
      type: 'group',
    });
    expect(r.status).toBe(201);
    return (await r.json()).data;
  };
  const a = await company(),
    b = await company();
  const input = (subjectId = a.id) => ({
    subjectId,
    code: `SUP-${randomUUID()}`,
    name: 'Isolated supplier',
    registrationCode: '',
    notes: 'Company notes',
    requestKey: randomUUID(),
  });
  const create = async (body = input(), session = admin) => {
    const r = await send(session, '/procurement/suppliers', body);
    const payload = await r.json();
    expect(r.status).toBe(201);
    expect(supplierView.safeParse(payload.data).success).toBe(true);
    return payload.data;
  };
  const grant = async (
    actions: readonly SupplierAction[] = supplierActions,
    allowed = [a.id],
  ) => {
    const role = await authz.permissionSets.create({
      key: randomUUID(),
      title: 'Isolated supplier role',
      grants: [
        {
          resource: { type: 'composite', id: 'procurement.suppliers' },
          actions: actions.map((action) => ({
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
                  params: { subjectIds: allowed },
                },
                supplyChainAudit: {
                  type: 'recordAccess',
                  key: 'procurement.supplierCompanies',
                  params: { subjectIds: allowed },
                },
                orgSubjects: {
                  type: 'recordAccess',
                  key: 'supplyChain.subjects',
                  params: { subjectIds: allowed },
                },
              },
            },
          })),
        },
      ],
    });
    return authz.permissionSets.assign({
      permissionSet: role.key,
      subject: { type: 'user', id: memberUser.id },
    });
  };
  return { admin, authz, user, memberUser, member, a, b, input, create, grant };
}

test('authenticates before validation and keeps page-only grants separate from business actions', async ({
  testApp,
  request,
}) => {
  for (const p of [
    '/procurement/suppliers',
    '/procurement/supplierCompanies',
    '/procurement/supplierIdentities',
    `/procurement/suppliers/${randomUUID()}/history`,
  ])
    expect((await request(p)).status).toBe(401);
  const f = await fixture(testApp);
  expect(
    (await f.member.fetch('/procurement/suppliers?subjectId=bad')).status,
  ).toBe(403);
  expect((await send(f.member, '/procurement/suppliers', {})).status).toBe(403);
  const page = await f.authz.permissionSets.create({
    key: randomUUID(),
    title: 'Page only',
    grants: [
      {
        resource: { type: 'page', id: 'procurement-suppliers' },
        actions: [{ action: 'access' }],
      },
    ],
  });
  await f.authz.permissionSets.assign({
    permissionSet: page.key,
    subject: { type: 'user', id: f.memberUser.id },
  });
  expect(
    (await f.member.fetch(`/procurement/suppliers?subjectId=${f.a.id}`)).status,
  ).toBe(403);
  const assignment = await f.grant(['read']);
  expect(
    (await f.member.fetch('/procurement/suppliers?subjectId=bad')).status,
  ).toBe(400);
  expect(
    (await f.member.fetch(`/procurement/suppliers?subjectId=${f.a.id}`)).status,
  ).toBe(200);
  expect(
    (await send(f.member, '/procurement/suppliers', f.input())).status,
  ).toBe(403);
  await f.authz.permissionSets.revoke(assignment.id);
  expect(
    (await f.member.fetch(`/procurement/suppliers?subjectId=${f.a.id}`)).status,
  ).toBe(403);
});

test('creates identity, relationship, lifecycle and audit atomically; normalizes unique identifiers', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp);
  const code = `ＳＵＰ-${randomUUID().toUpperCase()}`;
  const first = await f.create({
    ...f.input(),
    code: ` ${code} `,
    registrationCode: ' ＡＢ １２３ ',
  });
  expect(first.identity.code).toBe(code.normalize('NFKC'));
  expect(first.identity.registrationCode).toBe('AB123');
  expect(first.status).toBe('active');
  expect(first.identity.status).toBe('active');
  expect(
    await database
      .repository('supplyChainAudit')
      .count({ filter: { recordId: first.id } }),
  ).toBe(1);
  expect(
    await database
      .repository('supplyChainAudit')
      .count({ filter: { recordId: first.partnerId } }),
  ).toBe(1);
  const runtime = testApp.application.container.resolve(recordLifecycleToken);
  expect(
    (await runtime.view('businessPartners', first.partnerId, { id: f.user.id }))
      .history.transitions.length,
  ).toBe(1);
  const duplicate = await send(f.admin, '/procurement/suppliers', {
    ...f.input(),
    registrationCode: 'ab123',
  });
  expect(duplicate.status).toBe(409);
  expect((await duplicate.json()).error.reason).toBe(
    'SUPPLIER_IDENTITY_CONFLICT',
  );
  const second = await f.create();
  const third = await f.create();
  expect(second.identity.registrationCode).toBeNull();
  expect(third.identity.registrationCode).toBeNull();
});

test('enforces company scopes for lists, detail, audit, options, writes and replay', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp);
  await f.grant();
  const own = await f.create(f.input(), f.member),
    other = await f.create(f.input(f.b.id));
  const list = await (
    await f.member.fetch(`/procurement/suppliers?subjectId=${f.a.id}`)
  ).json();
  expect(list.data.map((r: { id: string }) => r.id)).toEqual([own.id]);
  expect(
    (await f.member.fetch(`/procurement/suppliers?subjectId=${f.b.id}`)).status,
  ).toBe(400);
  for (const path of [
    `/procurement/suppliers/${other.id}`,
    `/procurement/suppliers/${other.id}/history`,
  ])
    expect((await f.member.fetch(path)).status).toBe(404);
  expect(
    (
      await send(
        f.member,
        `/procurement/suppliers/${other.id}`,
        { ...mutation(other.revision), notes: 'forged' },
        'PATCH',
      )
    ).status,
  ).toBe(404);
  const companyOptions = await (
    await f.member.fetch('/procurement/supplierCompanies')
  ).json();
  expect(companyOptions.data.map((c: { id: string }) => c.id)).toEqual([
    f.a.id,
  ]);
  expect(
    (await send(f.member, '/procurement/suppliers', f.input(f.b.id))).status,
  ).toBe(400);
  expect(
    await database
      .repository('partnerSubjectSettings')
      .count({ filter: { subjectId: f.b.id } }),
  ).toBe(1);
  const secretSearch = await (
    await f.member.fetch(
      `/procurement/suppliers?subjectId=${f.a.id}&q=${other.identity.code}`,
    )
  ).json();
  expect(secretSearch.meta.total).toBe(0);
});

test('company maintainers cannot edit or enumerate shared identities and unknown fields cannot bypass ownership', async ({
  testApp,
}) => {
  const f = await fixture(testApp);
  await f.grant(['read', 'create', 'updateRelationship']);
  const row = await f.create(f.input(), f.member);
  expect((await f.member.fetch('/procurement/supplierIdentities')).status).toBe(
    403,
  );
  expect(
    (
      await send(
        f.member,
        `/procurement/supplierIdentities/${row.partnerId}`,
        { ...row.identity, ...mutation(row.identity.revision) },
        'PATCH',
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await send(
        f.member,
        `/procurement/suppliers/${row.id}`,
        { ...mutation(row.revision), notes: 'valid', partnerId: randomUUID() },
        'PATCH',
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await send(f.member, '/procurement/suppliers', {
        ...f.input(),
        partnerRole: 'customer',
      })
    ).status,
  ).toBe(400);
  expect(
    (await f.member.fetch('/procurement/supplierIdentities?unexpected=1'))
      .status,
  ).toBe(403);
});

test('keeps identity and company relationship status independent, and links one identity to multiple companies', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp),
    row = await f.create();
  expect(
    (
      await send(
        f.admin,
        `/procurement/supplierIdentities/${row.partnerId}/applicability`,
        {
          ...mutation(1),
          scopeMode: 'selected',
          regionIds: [],
          subjectIds: [f.a.id, f.b.id],
        },
        'PUT',
      )
    ).status,
  ).toBe(200);
  const linkInput = {
    subjectId: f.b.id,
    partnerId: row.partnerId,
    notes: 'second company',
    requestKey: randomUUID(),
  };
  const linked = await (
    await send(f.admin, '/procurement/supplierLinks', linkInput)
  ).json();
  expect(linked.data.partnerId).toBe(row.partnerId);
  expect(
    await database
      .repository('businessPartners')
      .count({ filter: { id: row.partnerId } }),
  ).toBe(1);
  expect(
    (
      await send(f.admin, '/procurement/supplierLinks', {
        ...linkInput,
        requestKey: randomUUID(),
      })
    ).status,
  ).toBe(409);
  const deactivated = await (
    await send(
      f.admin,
      `/procurement/suppliers/${row.id}/deactivate`,
      mutation(row.revision),
    )
  ).json();
  expect(deactivated.data.status).toBe('inactive');
  expect(deactivated.data.identity.status).toBe('active');
  const shared = await (
    await send(
      f.admin,
      `/procurement/supplierIdentities/${row.partnerId}/deactivate`,
      mutation(row.identity.revision),
    )
  ).json();
  expect(shared.data.status).toBe('inactive');
  expect(
    (
      await send(
        f.admin,
        `/procurement/suppliers/${row.id}/reactivate`,
        mutation(deactivated.data.revision),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await (
        await f.admin.fetch(`/procurement/suppliers/${linked.data.id}`)
      ).json()
    ).data.status,
  ).toBe('active');
});

test('replays identical writes once, rejects changed input and stale versions, and rechecks revoked permission', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp),
    assignment = await f.grant();
  const body = f.input(),
    row = await f.create(body, f.member);
  expect(
    (await (await send(f.member, '/procurement/suppliers', body)).json()).data,
  ).toEqual(row);
  expect(
    (
      await send(f.member, '/procurement/suppliers', {
        ...body,
        name: 'different',
      })
    ).status,
  ).toBe(409);
  const edit = { ...mutation(row.revision), notes: 'updated' };
  const changed = await (
    await send(f.member, `/procurement/suppliers/${row.id}`, edit, 'PATCH')
  ).json();
  expect(changed.data.revision).toBe(row.revision + 1);
  expect(
    (
      await (
        await send(f.member, `/procurement/suppliers/${row.id}`, edit, 'PATCH')
      ).json()
    ).data,
  ).toEqual(changed.data);
  expect(
    (
      await send(
        f.member,
        `/procurement/suppliers/${row.id}`,
        { ...edit, requestKey: randomUUID() },
        'PATCH',
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await send(
        f.member,
        `/procurement/suppliers/${row.id}`,
        { ...mutation(changed.data.revision), reason: '', notes: 'bad' },
        'PATCH',
      )
    ).status,
  ).toBe(400);
  expect(
    await database
      .repository('supplyChainAudit')
      .count({ filter: { recordId: row.id } }),
  ).toBe(2);
  await f.authz.permissionSets.revoke(assignment.id);
  expect((await send(f.member, '/procurement/suppliers', body)).status).toBe(
    403,
  );
});

test('rolls back identity, relationship, lifecycle, audit and replay when the second create fails', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp),
    body = f.input();
  const runtime = testApp.application.container.resolve(recordLifecycleToken),
    original = runtime.create.bind(runtime);
  const before = await database.repository('supplyChainAudit').count();
  let rolledBackPartnerId = '';
  const spy = vi
    .spyOn(runtime, 'create')
    .mockImplementation(async (...args) => {
      if (args[0] === 'partnerSubjectSettings')
        throw new Error('Injected relationship failure');
      const result = await original(...args);
      if (args[0] === 'businessPartners')
        rolledBackPartnerId = String(result.record.id);
      return result;
    });
  try {
    expect((await send(f.admin, '/procurement/suppliers', body)).status).toBe(
      500,
    );
  } finally {
    spy.mockRestore();
  }
  expect(
    await database
      .repository('businessPartners')
      .exists({ filter: { code: body.code.toUpperCase() } }),
  ).toBe(false);
  expect(await database.repository('supplyChainAudit').count()).toBe(before);
  await expect(
    runtime.view('businessPartners', rolledBackPartnerId, { id: f.user.id }),
  ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  expect(
    await database
      .repository('supplyChainActionRequests')
      .exists({ filter: { requestKey: body.requestKey } }),
  ).toBe(false);
  await f.create(body);
});

test('enforces separate create/update row and field policies around lifecycle persistence', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp),
    service = testApp.application.container.resolve(supplierServiceToken);
  const allow = {
    read: true,
    create: true,
    update: true,
    delete: false,
  } as const;
  const p: MaterialPolicies = Object.fromEntries(
    [
      'businessPartners',
      'partnerSubjectSettings',
      'supplyChainAudit',
      'orgSubjects',
      'orgRegions',
      'partnerRolePolicies',
      'partnerRegionScopes',
      'partnerCompanyScopes',
    ].map((k) => [k, allow]),
  );
  const body = f.input();
  await expect(
    service.create(
      body,
      { id: f.user.id },
      {
        ...p,
        partnerSubjectSettings: {
          ...allow,
          create: { scope: { subjectId: f.b.id } },
        },
      },
    ),
  ).rejects.toMatchObject({ reason: 'SUPPLIER_FORBIDDEN' });
  expect(
    await database
      .repository('businessPartners')
      .exists({ filter: { code: body.code.toUpperCase() } }),
  ).toBe(false);
  const row = await service.create(body, { id: f.user.id }, p);
  await expect(
    service.updateRelationship(
      row.id,
      { ...mutation(row.revision), notes: 'forbidden' },
      { id: f.user.id },
      {
        ...p,
        partnerSubjectSettings: {
          ...allow,
          update: { scope: true, fields: ['status'] },
        },
      },
    ),
  ).rejects.toMatchObject({ reason: 'SUPPLIER_FORBIDDEN' });
  await expect(
    service.updateRelationship(
      row.id,
      { ...mutation(row.revision), notes: 'forbidden' },
      { id: f.user.id },
      {
        ...p,
        partnerSubjectSettings: {
          ...allow,
          update: { scope: { subjectId: f.b.id } },
        },
      },
    ),
  ).rejects.toMatchObject({ reason: 'SUPPLIER_FORBIDDEN' });
  expect((await service.detail(row.id, p)).notes).toBe(body.notes);
  const edit = { ...mutation(row.revision), notes: 'allowed once' };
  await service.updateRelationship(row.id, edit, { id: f.user.id }, p);
  await expect(
    service.updateRelationship(
      row.id,
      edit,
      { id: f.user.id },
      {
        ...p,
        partnerSubjectSettings: { ...allow, update: false },
      },
    ),
  ).rejects.toMatchObject({ reason: 'SUPPLIER_FORBIDDEN' });
  await expect(
    service.create(
      body,
      { id: f.user.id },
      {
        ...p,
        businessPartners: { ...allow, create: false },
      },
    ),
  ).rejects.toMatchObject({ reason: 'SUPPLIER_FORBIDDEN' });
});

test('publishes exact scoped pagination and company relationship history', async ({
  testApp,
}) => {
  const f = await fixture(testApp);
  await f.grant(['read']);
  for (let i = 0; i < 3; i++)
    await f.create({ ...f.input(), name: `Paging supplier ${i}` });
  const response = await f.member.fetch(
    `/procurement/suppliers?subjectId=${f.a.id}&q=Paging&page=2&pageSize=2&orderBy=updatedAt`,
  );
  const page = await response.json();
  expect(page.meta).toEqual({ total: 3, page: 2, pageSize: 2 });
  expect(page.data).toHaveLength(1);
  const history = await (
    await f.member.fetch(`/procurement/suppliers/${page.data[0].id}/history`)
  ).json();
  expect(history.meta.total).toBe(1);
  expect(history.data[0].kind).toBe('partnerSubjectSettings');
  expect(history.data[0].actorName).toBeTruthy();
  expect(
    (
      await f.member.fetch(
        `/procurement/suppliers?subjectId=${f.a.id}&pageSize=101`,
      )
    ).status,
  ).toBe(400);
});

test('keeps permission initialization idempotent and preserves administrator edits', async ({
  database,
}) => {
  const repo = database.repository('authorizationPermissionSets');
  const original = await repo.findOne({
    filter: { key: 'procurement-supplier-reader' },
  });
  expect(original).toBeTruthy();
  await repo.updateOne({
    filter: { id: String(original!.id) },
    values: { title: 'Administrator custom title' },
  });
  const run = () =>
    supplierDefaults.run({
      repository: (name: string) => database.repository(name),
    } as Parameters<typeof supplierDefaults.run>[0]);
  await run();
  await run();
  expect(
    (await repo.findOne({ filter: { id: String(original!.id) } }))!.title,
  ).toBe('Administrator custom title');
  expect(
    await database
      .repository('authorizationPermissionSetAssignments')
      .count({ filter: { permissionSetKey: 'procurement-supplier-reader' } }),
  ).toBe(0);
});

test('documents every supplier route and exposes no raw collection write routes', async ({
  testApp,
}) => {
  expect(findUndeclaredApiRoutes(testApp.application)).toEqual([]);
  const doc = await testApp.application.container
    .resolve(apiDocsToken)
    .getDocument();
  expect(findApiDocumentSchemaProblems(doc)).toEqual([]);
  expect(doc.paths?.['/api/procurement/suppliers']?.post?.operationId).toBe(
    'createProcurementSupplier',
  );
  expect(doc.paths?.['/api/businessPartners/findMany']).toBeUndefined();
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  expect((await send(admin, '/businessPartners/findMany', {})).status).toBe(
    404,
  );
});

test('revises shared identity with its own version and audit, preserving company notes', async ({
  testApp,
}) => {
  const f = await fixture(testApp),
    row = await f.create();
  await f.authz.permissionSets.assign({
    permissionSet: 'procurement-supplier-master',
    subject: { type: 'user', id: f.memberUser.id },
  });
  const body = {
    ...mutation(row.identity.revision),
    code: row.identity.code,
    name: 'Revised shared identity',
    registrationCode: `REG-${randomUUID()}`,
  };
  const response = await send(
    f.member,
    `/procurement/supplierIdentities/${row.partnerId}`,
    body,
    'PATCH',
  );
  expect(response.status).toBe(200);
  const changed = (await response.json()).data;
  expect(changed.revision).toBe(row.identity.revision + 1);
  const current = (
    await (await f.admin.fetch(`/procurement/suppliers/${row.id}`)).json()
  ).data;
  expect(current.notes).toBe(row.notes);
  expect(current.identity.name).toBe(body.name);
  const history = await (
    await f.member.fetch(
      `/procurement/supplierIdentities/${row.partnerId}/history`,
    )
  ).json();
  expect(history.meta.total).toBe(2);
  expect(history.data[0].beforeValue.name).toBe(row.identity.name);
  expect(history.data[0].actorName).toBeTruthy();
  expect(
    (
      await send(
        f.member,
        `/procurement/supplierIdentities/${row.partnerId}`,
        { ...body, requestKey: randomUUID() },
        'PATCH',
      )
    ).status,
  ).toBe(409);
});

test('backs identity and company uniqueness and references with real database constraints', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp),
    row = await f.create();
  const partner = await database
    .repository('businessPartners')
    .findOne({ filter: { id: row.partnerId } });
  await expect(
    database
      .repository('businessPartners')
      .createOne({ values: { ...partner, id: randomUUID() } }),
  ).rejects.toBeTruthy();
  const setting = await database
    .repository('partnerSubjectSettings')
    .findOne({ filter: { id: row.id } });
  await expect(
    database
      .repository('partnerSubjectSettings')
      .createOne({ values: { ...setting, id: randomUUID() } }),
  ).rejects.toBeTruthy();
  await expect(
    database.repository('partnerSubjectSettings').createOne({
      values: { ...setting, id: randomUUID(), subjectId: randomUUID() },
    }),
  ).rejects.toBeTruthy();
});

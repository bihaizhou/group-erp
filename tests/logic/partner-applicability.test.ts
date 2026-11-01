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
import { recordLifecycleToken } from '../../server/providers/record-lifecycle.js';
import { supplierServiceToken } from '../../server/providers/procurement.js';
import { matchingPartnerPolicies } from '../../server/providers/partner-applicability.js';
import type { MaterialPolicies } from '../../server/providers/material-service.js';
import scopeDefaults from '../../database/main/seeds/202610170005_supplier_applicability_defaults.js';
import pageDefaults from '../../database/main/seeds/202610170006_supplier_page_defaults.js';
import { supplierSettingColumns } from '../../server/providers/supplier-model.js';

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
const send = (s: Session, path: string, body: unknown, method = 'POST') =>
  s.fetch(path, {
    method,
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  });
const mutation = (version: number) => ({
  version,
  reason: 'Isolated applicability verification',
  requestKey: randomUUID(),
});
const policyTables = [
  'businessPartners',
  'partnerSubjectSettings',
  'orgSubjects',
  'orgRegions',
  'supplyChainAudit',
  'partnerRolePolicies',
  'partnerRegionScopes',
  'partnerCompanyScopes',
];
const allow = { read: true, create: true, update: true, delete: true } as const;
const fullPolicies: MaterialPolicies = Object.fromEntries(
  policyTables.map((key) => [key, allow]),
);

async function fixture(testApp: TestApp) {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS),
    authz = testApp.application.container.resolve(authorizationToken);
  const create = async (path: string, values: object) => {
    const r = await send(admin, path, values);
    expect(r.status).toBe(201);
    return (await r.json()).data;
  };
  const org = (kind: string, values: object) =>
    create(`/organization/${kind}`, {
      code: randomUUID(),
      name: 'Isolated scope reference',
      ...values,
    });
  const sector = await org('sectors', {}),
    domestic = await org('regions', {}),
    east = await org('regions', { parentId: domestic.id }),
    leaf = await org('regions', { parentId: east.id }),
    west = await org('regions', { parentId: domestic.id }),
    overseas = await org('regions', {});
  const company = (regionId: string) =>
    org('subjects', { type: 'company', regionId, sectorId: sector.id });
  const a = await company(leaf.id),
    b = await company(west.id),
    c = await company(overseas.id),
    hq = await org('subjects', { type: 'group' });
  const supplier = await create('/procurement/suppliers', {
    subjectId: a.id,
    code: `S-${randomUUID()}`,
    name: 'Applicable supplier',
    notes: '',
    requestKey: randomUUID(),
  });
  const base = `/procurement/supplierIdentities/${supplier.partnerId}/applicability`;
  const get = async () => (await (await admin.fetch(base)).json()).data;
  const configure = async (
    scopeMode: 'all' | 'selected',
    regionIds: string[] = [],
    subjectIds: string[] = [],
  ) => {
    const response = await send(
      admin,
      base,
      { ...mutation((await get()).revision), scopeMode, regionIds, subjectIds },
      'PUT',
    );
    expect(response.status).toBe(200);
    return (await response.json()).data;
  };
  const options = async (subjectId: string, session = admin) => {
    const response = await session.fetch(
      `/procurement/supplierOptions?subjectId=${subjectId}&q=${supplier.identity.code}`,
    );
    expect(response.status).toBe(200);
    return (await response.json()).data;
  };
  const override = async (
    subjectId: string,
    status: 'active' | 'inactive',
    version = 0,
    session = admin,
  ) =>
    send(session, '/procurement/supplierOverrides', {
      ...mutation(version),
      subjectId,
      partnerId: supplier.partnerId,
      status,
      notes: 'Company scope override',
    });
  const user = async (actions: string[], subjects = [a.id]) => {
    const password = randomUUID(),
      email = `${randomUUID()}@example.test`;
    const account = await testApp.application.container
      .resolve(userAdministrationServiceToken)
      .create({ name: 'Scope test user', email, password });
    const role = await authz.permissionSets.create({
      key: randomUUID(),
      title: 'Isolated supplier scope role',
      grants: [
        {
          resource: { type: 'composite', id: 'procurement.suppliers' },
          actions: actions.map((action) => ({
            action,
            policy: {
              type: 'composite',
              scopes: {
                ...Object.fromEntries(
                  policyTables.map((t) => [t, 'allRecords']),
                ),
                orgSubjects: {
                  type: 'recordAccess',
                  key: 'supplyChain.subjects',
                  params: { subjectIds: subjects },
                },
                partnerSubjectSettings: {
                  type: 'recordAccess',
                  key: 'procurement.supplierCompanies',
                  params: { subjectIds: subjects },
                },
                supplyChainAudit:
                  action === 'configureApplicability'
                    ? 'allRecords'
                    : {
                        type: 'recordAccess',
                        key: 'procurement.supplierCompanies',
                        params: { subjectIds: subjects },
                      },
              },
            },
          })),
        },
      ],
    });
    const assignment = await authz.permissionSets.assign({
      permissionSet: role.key,
      subject: { type: 'user', id: account.id },
    });
    return {
      account,
      role,
      assignment,
      session: await signIn(testApp, { email, password }),
    };
  };
  return {
    admin,
    authz,
    a,
    b,
    c,
    hq,
    domestic,
    east,
    leaf,
    overseas,
    company,
    supplier,
    base,
    get,
    configure,
    options,
    override,
    user,
  };
}

test('exposes row capabilities independently and filters final availability before pagination', async ({
  testApp,
  request,
}) => {
  const f = await fixture(testApp);
  const reader = await f.user(['read']);
  const local = await f.user(['read', 'updateRelationship']);
  const path = `/procurement/supplierCapabilities/${f.supplier.partnerId}?subjectId=${f.a.id}`;
  expect((await (await reader.session.fetch(path)).json()).data).toEqual({
    updateIdentity: false,
    configureApplicability: false,
    updateRelationship: false,
  });
  expect(
    (await (await local.session.fetch(path)).json()).data.updateRelationship,
  ).toBe(true);
  expect((await (await f.admin.fetch(path)).json()).data).toEqual({
    updateIdentity: true,
    configureApplicability: true,
    updateRelationship: true,
  });
  const outside = await local.session.fetch(
    `/procurement/supplierCapabilities/${f.supplier.partnerId}?subjectId=${f.b.id}`,
  );
  expect((await outside.json()).data.updateRelationship).toBe(false);
  await f.override(f.a.id, 'inactive', 1);
  const active = await f.admin.fetch(
    `/procurement/supplierAvailability?subjectId=${f.a.id}&status=active&orderBy=-updatedAt`,
  );
  expect((await active.json()).meta.total).toBe(0);
  const inactive = await f.admin.fetch(
    `/procurement/supplierAvailability?subjectId=${f.a.id}&status=inactive&orderBy=updatedAt`,
  );
  const payload = await inactive.json();
  expect(payload.meta.total).toBe(1);
  expect(payload.data[0].updatedAt).toMatch(/^202/);
  expect((await request(path)).status).toBe(401);
});
test('resolves saved scope labels including inactive references without granting a company reader global reference access', async ({
  testApp,
}) => {
  const f = await fixture(testApp),
    reader = await f.user(['read']);
  const path = `/procurement/supplierScopeReferences?regionId=${f.east.id}&subjectId=${f.a.id}`;
  expect((await reader.session.fetch(path)).status).toBe(403);
  const references = (await (await f.admin.fetch(path)).json()).data;
  expect(references.regions[0]).toMatchObject({
    id: f.east.id,
    status: 'active',
  });
  expect(references.companies[0]).toMatchObject({
    id: f.a.id,
    status: 'active',
  });
  expect(
    (await f.admin.fetch(`/procurement/supplierCompanies/${f.a.id}`)).status,
  ).toBe(200);
  expect(
    (await reader.session.fetch(`/procurement/supplierCompanies/${f.b.id}`))
      .status,
  ).toBe(404);
  const scope = await f.user(['configureApplicability']);
  expect(
    (
      await scope.session.fetch(
        `/procurement/supplierScopeIdentities/${f.supplier.partnerId}`,
      )
    ).status,
  ).toBe(200);
  expect(
    (await reader.session.fetch('/procurement/supplierScopeIdentities')).status,
  ).toBe(403);
  for (const path of [
    '/procurement/supplierIdentities',
    '/procurement/supplierScopeIdentities',
  ]) {
    const response = await f.admin.fetch(path);
    expect(response.status).toBe(200);
    expect(
      (await response.json()).data.some(
        (v: { id: string }) => v.id === f.supplier.partnerId,
      ),
    ).toBe(true);
  }
});
test('adds only missing supplier page grants and preserves an explicit administrator choice', async ({
  database,
}) => {
  const repo = database.repository('authorizationPermissionSets');
  const master = await repo.findOne({
    filter: { key: 'procurement-supplier-master' },
  });
  const grants = (
    typeof master!.grants === 'string'
      ? JSON.parse(master!.grants)
      : master!.grants
  ) as Array<{ resource: { type: string; id: string }; actions: unknown[] }>;
  const custom = grants.filter((v) => v.resource.type !== 'page');
  custom.push({
    resource: { type: 'page', id: 'procurement-suppliers' },
    actions: [],
  });
  await repo.updateOne({
    filter: { id: master!.id as string },
    values: { grants: custom },
  });
  await pageDefaults.run({
    repository: database.repository.bind(database),
  } as Parameters<typeof pageDefaults.run>[0]);
  const actual = await repo.findOne({ filter: { id: master!.id as string } });
  const stored =
    typeof actual!.grants === 'string'
      ? JSON.parse(actual!.grants)
      : actual!.grants;
  expect(stored).toEqual(custom);
});

test('defaults to the initial company and all-company scope includes future project companies without copying relationships', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp);
  expect(await f.options(f.a.id)).toHaveLength(1);
  expect(await f.options(f.b.id)).toHaveLength(0);
  const policy = await f.configure('all');
  expect(policy).toMatchObject({
    scopeMode: 'all',
    subjectIds: [],
    regionIds: [],
  });
  for (const subject of [f.a, f.b, f.c])
    expect(await f.options(subject.id)).toHaveLength(1);
  const future = await f.company(f.east.id);
  expect(await f.options(future.id)).toHaveLength(1);
  const detail = await (
    await f.admin.fetch(
      `/procurement/supplierAvailability/${f.supplier.partnerId}?subjectId=${future.id}`,
    )
  ).json();
  expect(detail.data).toMatchObject({
    partnerId: f.supplier.partnerId,
    settingId: null,
    revision: 0,
    scopeMatch: 'all',
  });
  expect(await f.options(f.hq.id)).toHaveLength(0);
  expect(
    await database
      .repository('partnerSubjectSettings')
      .count({ filter: { partnerId: f.supplier.partnerId } }),
  ).toBe(1);
});

test('matches regional descendants, unions explicit companies and recalculates after company region changes', async ({
  testApp,
}) => {
  const f = await fixture(testApp);
  await f.configure('selected', [f.domestic.id]);
  expect((await f.options(f.a.id))[0].scopeMatch).toBe('region');
  expect(await f.options(f.b.id)).toHaveLength(1);
  expect(await f.options(f.c.id)).toHaveLength(0);
  await f.configure('selected', [f.east.id], [f.c.id]);
  expect(await f.options(f.a.id)).toHaveLength(1);
  expect(await f.options(f.b.id)).toHaveLength(0);
  expect((await f.options(f.c.id))[0].scopeMatch).toBe('company');
  const moved = await send(
    f.admin,
    `/organization/subjects/${f.a.id}`,
    {
      version: f.a.version,
      reason: 'Isolated regional reassignment',
      regionId: f.overseas.id,
    },
    'PATCH',
  );
  expect(moved.status).toBe(200);
  expect(await f.options(f.a.id)).toHaveLength(0);
});

test('global disable dominates local settings and global reactivation preserves individual company exclusions', async ({
  testApp,
}) => {
  const f = await fixture(testApp);
  await f.configure('all');
  const disabled = await f.override(f.b.id, 'inactive');
  expect(disabled.status).toBe(200);
  const local = (await disabled.json()).data;
  expect(await f.options(f.a.id)).toHaveLength(1);
  expect(await f.options(f.b.id)).toHaveLength(0);
  const globalOff = await send(
    f.admin,
    `${f.base}/deactivate`,
    mutation((await f.get()).revision),
  );
  expect(globalOff.status).toBe(200);
  expect(await f.options(f.a.id)).toHaveLength(0);
  expect((await f.override(f.b.id, 'active', local.revision)).status).toBe(400);
  // Keeping an already-active local setting while editing notes does not
  // restore effective availability or change the independent global policy.
  expect((await f.override(f.a.id, 'active', 1)).status).toBe(200);
  expect(await f.options(f.a.id)).toHaveLength(0);
  const availability = await (
    await f.admin.fetch(
      `/procurement/supplierAvailability?subjectId=${f.b.id}&q=${f.supplier.identity.code}`,
    )
  ).json();
  expect(availability.data[0]).toMatchObject({
    supplierStatus: 'inactive',
    companyStatus: 'inactive',
    effectiveStatus: 'inactive',
  });
  expect(
    (
      await send(
        f.admin,
        `${f.base}/reactivate`,
        mutation((await f.get()).revision),
      )
    ).status,
  ).toBe(200);
  expect(await f.options(f.a.id)).toHaveLength(1);
  expect(await f.options(f.b.id)).toHaveLength(0);
  expect((await f.override(f.b.id, 'active', local.revision)).status).toBe(200);
  expect(await f.options(f.b.id)).toHaveLength(1);
});

test('a local restore or explicit link cannot expand applicability and all-company scope grants no cross-company user access', async ({
  testApp,
  request,
}) => {
  const f = await fixture(testApp),
    member = await f.user(['read', 'updateRelationship']);
  expect((await request('/procurement/supplierOptions')).status).toBe(401);
  expect((await f.override(f.b.id, 'active')).status).toBe(400);
  expect(
    (
      await send(f.admin, '/procurement/supplierLinks', {
        partnerId: f.supplier.partnerId,
        subjectId: f.b.id,
        notes: '',
        requestKey: randomUUID(),
      })
    ).status,
  ).toBe(400);
  expect((await send(member.session, f.base, {}, 'PUT')).status).toBe(403);
  expect(
    (await member.session.fetch('/procurement/supplierScopeRegions?page=bad'))
      .status,
  ).toBe(403);
  await f.configure('all');
  expect(await f.options(f.a.id, member.session)).toHaveLength(1);
  expect(
    (
      await member.session.fetch(
        `/procurement/supplierOptions?subjectId=${f.b.id}`,
      )
    ).status,
  ).toBe(400);
  const off = await f.override(
    f.a.id,
    'inactive',
    f.supplier.revision,
    member.session,
  );
  expect(off.status).toBe(200);
  expect(await f.options(f.a.id, member.session)).toHaveLength(0);
  expect(
    (
      await send(
        member.session,
        `${f.base}/deactivate`,
        mutation((await f.get()).revision),
      )
    ).status,
  ).toBe(403);
});

test('rejects invalid references, inconsistent modes and stale configuration while keeping replay and complete scope snapshots', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp),
    before = await f.get();
  for (const body of [
    { scopeMode: 'all', regionIds: [f.east.id], subjectIds: [] },
    { scopeMode: 'selected', regionIds: [], subjectIds: [] },
    { scopeMode: 'selected', regionIds: [randomUUID()], subjectIds: [] },
  ])
    expect(
      (
        await send(
          f.admin,
          f.base,
          { ...mutation(before.revision), ...body },
          'PUT',
        )
      ).status,
    ).toBe(400);
  expect(await f.get()).toEqual(before);
  const body = {
    ...mutation(before.revision),
    scopeMode: 'selected',
    regionIds: [f.east.id],
    subjectIds: [f.c.id],
  };
  const changed = await (await send(f.admin, f.base, body, 'PUT')).json();
  expect(
    (await (await send(f.admin, f.base, body, 'PUT')).json()).data,
  ).toEqual(changed.data);
  expect(
    (await send(f.admin, f.base, { ...body, subjectIds: [f.b.id] }, 'PUT'))
      .status,
  ).toBe(409);
  expect(
    (await send(f.admin, f.base, { ...body, requestKey: randomUUID() }, 'PUT'))
      .status,
  ).toBe(409);
  const history = await (await f.admin.fetch(`${f.base}/history`)).json();
  expect(history.meta.total).toBe(2);
  expect(history.data[0].afterValue.regionIds).toEqual([f.east.id]);
  expect(history.data[0].beforeValue.subjectIds).toEqual([f.a.id]);
  expect(
    await database
      .repository('partnerRegionScopes')
      .count({ filter: { policyId: before.id } }),
  ).toBe(1);
  const member = await f.user(['configureApplicability']);
  expect(
    (
      await send(
        member.session,
        f.base,
        {
          ...mutation(changed.data.revision),
          scopeMode: 'selected',
          regionIds: [],
          subjectIds: [f.b.id],
        },
        'PUT',
      )
    ).status,
  ).toBe(400);
});

test('rolls back replaced scope rows, lifecycle, audit and replay if the lifecycle edit fails', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp),
    before = await f.get(),
    runtime = testApp.application.container.resolve(recordLifecycleToken);
  const original = runtime.fire.bind(runtime),
    body = {
      ...mutation(before.revision),
      scopeMode: 'all',
      regionIds: [],
      subjectIds: [],
    };
  const spy = vi.spyOn(runtime, 'fire').mockImplementation(async (...args) => {
    if (args[0] === 'partnerRolePolicies')
      throw new Error('Injected scope transition failure');
    return original(...args);
  });
  try {
    expect((await send(f.admin, f.base, body, 'PUT')).status).toBe(500);
  } finally {
    spy.mockRestore();
  }
  expect(await f.get()).toEqual(before);
  expect(
    await database
      .repository('supplyChainActionRequests')
      .exists({ filter: { requestKey: body.requestKey } }),
  ).toBe(false);
  expect(
    await database
      .repository('supplyChainAudit')
      .count({ filter: { kind: 'partnerRolePolicies', recordId: before.id } }),
  ).toBe(1);
});

test('hidden local exclusions never become enabled defaults and direct write scope cannot be bypassed', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp);
  await f.configure('all');
  expect((await f.override(f.b.id, 'inactive')).status).toBe(200);
  const service = testApp.application.container.resolve(supplierServiceToken),
    p = {
      ...fullPolicies,
      partnerSubjectSettings: {
        ...allow,
        read: { scope: { status: 'active' }, fields: supplierSettingColumns },
      },
    };
  expect(
    (
      await service.availability(
        {
          subjectId: f.b.id,
          q: f.supplier.identity.code,
          page: 1,
          pageSize: 20,
        },
        p,
        true,
      )
    ).data,
  ).toHaveLength(0);
  await expect(
    service.overrideCompany(
      {
        ...mutation(0),
        partnerId: f.supplier.partnerId,
        subjectId: f.b.id,
        status: 'active',
        notes: '',
      },
      { id: 'scope-test' },
      p,
    ),
  ).rejects.toMatchObject({ reason: 'SUPPLIER_FORBIDDEN' });
  expect(
    await database.repository('partnerSubjectSettings').count({
      filter: { partnerId: f.supplier.partnerId, subjectId: f.b.id },
    }),
  ).toBe(1);
});

test('keeps supplier and customer global roles independent on one shared identity', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp),
    now = new Date(),
    customerId = randomUUID();
  await f.configure('all');
  await database.repository('partnerRolePolicies').createOne({
    values: {
      id: customerId,
      partnerId: f.supplier.partnerId,
      partnerRole: 'customer',
      scopeMode: 'all',
      status: 'active',
      revision: 1,
      lifecycleVersion: 0,
      statusChangedAt: now,
      createdBy: 'test',
      createdAt: now,
      updatedAt: now,
    },
  });
  expect(
    (
      await send(
        f.admin,
        `${f.base}/deactivate`,
        mutation((await f.get()).revision),
      )
    ).status,
  ).toBe(200);
  const company = await database
    .repository('orgSubjects')
    .findOne({ filter: { id: f.b.id } });
  const customerMatches = await matchingPartnerPolicies(
    database.connection(),
    company!,
    fullPolicies,
    f.supplier.partnerId,
    'customer',
  );
  expect(customerMatches).toHaveLength(1);
  expect(customerMatches[0].policy.status).toBe('active');
  expect(await f.options(f.b.id)).toHaveLength(0);
  expect(
    (await database
      .repository('businessPartners')
      .findOne({ filter: { id: f.supplier.partnerId } }))!.status,
  ).toBe('active');
});

test('transactional supplier selection rechecks global and local changes without creating purchase or relationship records', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp);
  await f.configure('all');
  const body = { subjectId: f.b.id, partnerId: f.supplier.partnerId };
  const initial = await send(f.admin, '/procurement/supplierSelections', body);
  expect(initial.status).toBe(200);
  expect((await initial.json()).data).toMatchObject({
    subjectId: f.b.id,
    scopeMatch: 'all',
    companySettingRevision: 0,
  });
  expect(
    await database.repository('partnerSubjectSettings').count({
      filter: { subjectId: f.b.id, partnerId: f.supplier.partnerId },
    }),
  ).toBe(0);
  expect((await f.override(f.b.id, 'inactive')).status).toBe(200);
  expect(
    (await send(f.admin, '/procurement/supplierSelections', body)).status,
  ).toBe(400);
});

test('upgrades only missing scope dependencies, preserves configured companies and initializes a separate unassigned scope-maintenance role', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp),
    member = await f.user(['read']);
  const repo = database.repository('authorizationPermissionSets'),
    stored = await repo.findOne({ filter: { key: member.role.key } });
  const old =
    typeof stored!.grants === 'string'
      ? JSON.parse(stored!.grants)
      : JSON.parse(JSON.stringify(stored!.grants));
  for (const action of old[0].actions)
    for (const t of [
      'partnerRolePolicies',
      'partnerRegionScopes',
      'partnerCompanyScopes',
      'orgRegions',
    ])
      delete action.policy.scopes[t];
  await repo.updateOne({
    filter: { key: member.role.key },
    values: {
      grants: typeof stored!.grants === 'string' ? JSON.stringify(old) : old,
    },
  });
  const run = () =>
    scopeDefaults.run({
      repository: (name: string) => database.repository(name),
    } as Parameters<typeof scopeDefaults.run>[0]);
  await run();
  const once = (await repo.findOne({ filter: { key: member.role.key } }))!
    .grants;
  await run();
  expect(
    (await repo.findOne({ filter: { key: member.role.key } }))!.grants,
  ).toEqual(once);
  const grants =
    typeof once === 'string'
      ? JSON.parse(once)
      : JSON.parse(JSON.stringify(once));
  expect(grants[0].actions).toHaveLength(1);
  expect(
    grants[0].actions[0].policy.scopes.orgSubjects.params.subjectIds,
  ).toEqual([f.a.id]);
  expect(
    await database.repository('authorizationPermissionSetAssignments').count({
      filter: { permissionSetKey: 'procurement-supplier-scope-manager' },
    }),
  ).toBe(0);
});

test('declares all applicability APIs with strict security and response schemas', async ({
  testApp,
}) => {
  expect(findUndeclaredApiRoutes(testApp.application)).toEqual([]);
  const doc = await testApp.application.container
    .resolve(apiDocsToken)
    .getDocument();
  expect(findApiDocumentSchemaProblems(doc)).toEqual([]);
  expect(
    doc.paths?.['/api/procurement/supplierIdentities/{id}/applicability']?.put
      ?.operationId,
  ).toBe('configureProcurementSupplierApplicability');
});

test('accepts only one concurrent global decision for the same version', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp),
    before = await f.get();
  const responses = await Promise.all([
    send(f.admin, `${f.base}/deactivate`, mutation(before.revision)),
    send(
      f.admin,
      f.base,
      {
        ...mutation(before.revision),
        scopeMode: 'all',
        regionIds: [],
        subjectIds: [],
      },
      'PUT',
    ),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await f.get()).revision).toBe(before.revision + 1);
  expect(
    await database
      .repository('supplyChainAudit')
      .count({ filter: { kind: 'partnerRolePolicies', recordId: before.id } }),
  ).toBe(2);
});

test('refuses partial visibility of configuration rows instead of returning or overwriting a partial scope', async ({
  testApp,
}) => {
  const f = await fixture(testApp),
    service = testApp.application.container.resolve(supplierServiceToken),
    current = await f.get();
  const body = {
    ...mutation(current.revision),
    scopeMode: 'selected' as const,
    regionIds: [f.east.id],
    subjectIds: [],
  };
  expect((await send(f.admin, f.base, body, 'PUT')).status).toBe(200);
  const p: MaterialPolicies = {
    ...fullPolicies,
    partnerRegionScopes: {
      ...allow,
      read: {
        scope: { regionId: f.overseas.id },
        fields: ['id', 'policyId', 'regionId'],
      },
    },
  };
  await expect(
    service.applicability(f.supplier.partnerId, p),
  ).rejects.toMatchObject({ reason: 'SUPPLIER_FORBIDDEN' });
  await expect(
    service.configureApplicability(
      f.supplier.partnerId,
      body,
      { id: 'different-actor' },
      p,
    ),
  ).rejects.toMatchObject({ reason: 'SUPPLIER_FORBIDDEN' });
  expect((await f.get()).regionIds).toEqual([f.east.id]);
});

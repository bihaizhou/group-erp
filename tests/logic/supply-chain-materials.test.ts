// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import type { DatabaseManager } from '@nocobase/db';
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
import { materialServiceToken } from '../../server/providers/materials.js';
import {
  materialTables,
  MaterialError,
} from '../../server/providers/material-model.js';
import { businessMaterialColumns } from '../../server/providers/supply-chain-resources.js';
import { supplyChainMaterialServiceToken } from '../../server/providers/supply-chain.js';
import type { MaterialPolicies } from '../../server/providers/material-service.js';
import { businessDate } from '../../server/providers/business-date.js';
import selectorDefaults from '../../database/main/seeds/202610170002_supply_chain_material_defaults.js';
import { materialIdFilter } from '../../server/providers/material-filters.js';
import {
  materialOptionsMeta,
  materialSelectionOutput,
} from '../../server/providers/supply-chain-model.js';

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
type TestApp = Parameters<typeof signIn>[0];
type Session = Awaited<ReturnType<typeof signIn>>;
const send = (session: Session, path: string, body: unknown, method = 'POST') =>
  session.fetch(path, {
    method,
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  });

async function fixture(testApp: TestApp, database: DatabaseManager) {
  const suffix = randomUUID().slice(0, 8);
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const authz = testApp.application.container.resolve(authorizationToken);
  const createUser = async (name: string) => {
    const email = `${randomUUID()}@example.test`,
      password = randomUUID();
    const user = await users.create({ name, email, password });
    return { user, session: await signIn(testApp, { email, password }) };
  };
  const reviewer = await createUser('Independent reviewer');
  await authz.permissionSets.assign({
    permissionSet: 'materials-reviewer',
    subject: { type: 'user', id: reviewer.user.id },
  });
  const create = async (path: string, input: unknown) => {
    const response = await send(admin, path, input);
    const payload = await response.json();
    expect(response.status).toBe(201);
    return payload.data;
  };
  const fire = async (
    kind: string,
    record: { id: string; lifecycleVersion: number },
    transition: string,
    session = admin,
  ) => {
    const response = await send(
      session,
      `/materials/${kind}/${record.id}/${transition}`,
      {
        version: record.lifecycleVersion,
        requestKey: randomUUID(),
        reason: 'Isolated A2 verification',
      },
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    return payload.data;
  };
  const activate = async (
    kind: string,
    record: { id: string; lifecycleVersion: number },
  ) =>
    fire(kind, await fire(kind, record, 'submit'), 'approve', reviewer.session);
  const a = await create('/organization/subjects', {
    name: 'A2 company A',
    code: `A2-A-${suffix}`,
    type: 'group',
  });
  const b = await create('/organization/subjects', {
    name: 'A2 company B',
    code: `A2-B-${suffix}`,
    type: 'group',
  });
  const template = await create('/materials/templates', {
    name: 'A2 model',
    fields: [
      {
        key: 'model',
        title: 'Model',
        type: 'text',
        identity: true,
        required: true,
      },
    ],
  });
  const name = await create('/materials/names', {
    name: 'A2 gloves',
    templateId: template.id,
  });
  const each = await database
    .repository('measureUnits')
    .findOne({ filter: { code: 'EA' } });
  const box = await database
    .repository('measureUnits')
    .findOne({ filter: { code: 'BOX' } });
  const kg = await database
    .repository('measureUnits')
    .findOne({ filter: { code: 'KG' } });
  const sku = async (model: string, managementMode = 'stock') =>
    activate(
      'skus',
      await create('/materials/skus', {
        name: `Gloves ${model}`,
        materialNameId: name.id,
        baseUnitId: String(each!.id),
        managementMode,
        attributeValues: { model },
      }),
    );
  const first = await sku('A'),
    second = await sku('B'),
    nonStock = await sku('service', 'nonStock');
  const missing = await sku('not-approved-for-company');
  const disabled = await sku('inactive-setting');
  const set = (
    subjectId: string,
    skuId: string,
    canPurchase: boolean,
    canSell = false,
  ) =>
    create('/materials/subjectSettings', {
      name: 'Company material permission',
      subjectId,
      skuId,
      canPurchase,
      canSell,
    });
  const firstSetting = await set(a.id, first.id, true);
  await set(a.id, second.id, false, true);
  await set(a.id, nonStock.id, true);
  const disabledSetting = await set(a.id, disabled.id, true);
  await fire('subjectSettings', disabledSetting, 'deactivate');
  await set(b.id, second.id, true);
  const pack = await activate(
    'unitRules',
    await create('/materials/unitRules', {
      name: 'Box of twelve',
      skuId: first.id,
      unitId: String(box!.id),
      numerator: '12',
      denominator: '1',
    }),
  );
  const alias = async (
    label: string,
    targetId: string,
    subjectId?: string,
    targetKind = 'skus',
  ) =>
    activate(
      'references',
      await create('/materials/references', {
        name: label,
        targetKind,
        targetId,
        sourceType: 'alias',
        subjectId,
      }),
    );
  const member = await createUser('Company A requester');
  const grant = async (
    module = 'procurement',
    allowed = [a.id],
    omitted: string[] = [],
  ) => {
    const role = await authz.permissionSets.create({
      key: `a2-${randomUUID()}`,
      title: 'A2 scoped selection',
      grants: [
        {
          resource: { type: 'composite', id: `${module}.materials` },
          actions: [
            {
              action: 'read',
              policy: {
                type: 'composite',
                scopes: Object.fromEntries(
                  Object.keys(businessMaterialColumns).map((table) => [
                    table,
                    omitted.includes(table)
                      ? ''
                      : table === 'orgSubjects' ||
                          table === 'materialSubjectSettings'
                        ? {
                            type: 'recordAccess',
                            key:
                              table === 'orgSubjects'
                                ? 'supplyChain.subjects'
                                : 'supplyChain.companies',
                            params: { subjectIds: allowed },
                          }
                        : 'allRecords',
                  ]),
                ),
              },
            },
          ],
        },
      ],
    });
    return authz.permissionSets.assign({
      permissionSet: role.key,
      subject: { type: 'user', id: member.user.id },
    });
  };
  const list = (module = 'procurement', subject = a.id, q = '') =>
    member.session.fetch(
      `/${module}/materialOptions?subjectId=${subject}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    );
  const select = (
    input: unknown,
    module = 'procurement',
    session = member.session,
  ) => send(session, `/${module}/materialSelections`, input);
  const known = {
    kind: 'known' as const,
    subjectId: a.id,
    skuId: first.id,
    quantity: '10',
    unitId: String(each!.id),
  };
  return {
    admin,
    authz,
    create,
    fire,
    activate,
    createUser,
    a,
    b,
    name,
    first,
    second,
    nonStock,
    missing,
    disabled,
    firstSetting,
    each: each!,
    box: box!,
    kg: kg!,
    pack,
    alias,
    member,
    grant,
    list,
    select,
    known,
  };
}

test('authenticates before validation, separates page/catalog/business grants, and honors revocation', async ({
  testApp,
  database,
  request,
}) => {
  expect((await request('/procurement/materialOptions')).status).toBe(401);
  expect((await request('/requisitions/materialOptions')).status).toBe(401);
  const f = await fixture(testApp, database);
  expect(
    (
      await f.member.session.fetch(
        '/procurement/materialOptions?subjectId=invalid',
      )
    ).status,
  ).toBe(403);
  expect((await f.select({ malformed: true })).status).toBe(403);
  const pageRole = await f.authz.permissionSets.create({
    key: randomUUID(),
    title: 'Page only',
    grants: [
      {
        resource: { type: 'page', id: 'warehouse-materials' },
        actions: [{ action: 'access' }],
      },
    ],
  });
  await f.authz.permissionSets.assign({
    permissionSet: pageRole.key,
    subject: { type: 'user', id: f.member.user.id },
  });
  await f.authz.permissionSets.assign({
    permissionSet: 'materials-reader',
    subject: { type: 'user', id: f.member.user.id },
  });
  expect((await f.list()).status).toBe(403);
  const assignment = await f.grant();
  expect(
    (
      await f.member.session.fetch(
        '/procurement/materialOptions?subjectId=invalid',
      )
    ).status,
  ).toBe(400);
  expect((await f.list()).status).toBe(200);
  expect((await f.list('requisitions')).status).toBe(403);
  expect((await f.list('procurement', f.b.id)).status).toBe(404);
  await f.authz.permissionSets.revoke(assignment.id);
  expect((await f.list()).status).toBe(403);
  const seeded = await database
    .repository('authorizationPermissionSets')
    .findOne({ filter: { key: 'procurement-material-selector' } });
  expect(seeded).toBeTruthy();
  expect(
    await database
      .repository('authorizationPermissionSetAssignments')
      .count({ filter: { permissionSetKey: 'procurement-material-selector' } }),
  ).toBe(0);
  expect(findUndeclaredApiRoutes(testApp.application)).toEqual([]);
  const document = await testApp.application.container
    .resolve(apiDocsToken)
    .getDocument();
  expect(findApiDocumentSchemaProblems(document)).toEqual([]);
  expect(document.paths).toHaveProperty('/api/procurement/materialOptions');
  expect(document.paths).toHaveProperty('/api/requisitions/materialSelections');
});

test('applies company purchase eligibility, stock-only requisitions, and paginates eligible rows', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.grant();
  await f.grant('requisitions');
  const purchase = await (await f.list()).json();
  expect(materialOptionsMeta.safeParse(purchase.meta).success).toBe(true);
  expect(new Set(purchase.data.map((row: { id: string }) => row.id))).toEqual(
    new Set([f.first.id, f.nonStock.id]),
  );
  const issue = await (await f.list('requisitions')).json();
  expect(new Set(issue.data.map((row: { id: string }) => row.id))).toEqual(
    new Set([f.first.id, f.second.id]),
  );
  for (const skuId of [f.second.id, f.missing.id, f.disabled.id])
    expect((await f.select({ ...f.known, skuId })).status).toBe(404);
  expect(
    (await f.select({ ...f.known, skuId: f.second.id }, 'requisitions')).status,
  ).toBe(200);
  expect(
    (await f.select({ ...f.known, skuId: f.nonStock.id }, 'requisitions'))
      .status,
  ).toBe(404);
  const page = await (
    await f.member.session.fetch(
      `/procurement/materialOptions?subjectId=${f.a.id}&pageSize=1&page=2`,
    )
  ).json();
  expect(page.data).toHaveLength(1);
  expect(page.meta).toMatchObject({ page: 2, pageSize: 1, total: 2 });
  expect(
    (
      await f.member.session.fetch(
        `/procurement/materialOptions/${f.second.id}?subjectId=${f.a.id}`,
      )
    ).status,
  ).toBe(404);
  await f.fire('subjectSettings', f.firstSetting, 'deactivate');
  expect((await f.select(f.known)).status).toBe(404);
});

test('resolves only eligible company/global aliases and never hides ambiguous name targets', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.grant();
  await f.grant('requisitions');
  await f.alias('本公司手套', f.first.id, f.a.id);
  await f.alias('本公司手套', f.second.id, f.b.id);
  await f.alias('仅其他公司', f.second.id, f.b.id);
  let result = await (await f.list('procurement', f.a.id, '本公司手套')).json();
  expect(result.data.map((row: { id: string }) => row.id)).toEqual([
    f.first.id,
  ]);
  expect(result.meta.aliasMatch).toEqual({
    status: 'unique',
    skuId: f.first.id,
  });
  expect(
    (await (await f.list('procurement', f.a.id, '本公司')).json()).meta
      .aliasMatch.status,
  ).toBe('none');
  await f.alias('Ａ２ ＧＬＯＶＥ', f.first.id, f.a.id);
  expect(
    (await (await f.list('procurement', f.a.id, 'a2 glove')).json()).meta
      .aliasMatch,
  ).toEqual({ status: 'unique', skuId: f.first.id });
  const hidden = await (
    await f.list('procurement', f.a.id, '仅其他公司')
  ).json();
  expect(hidden.data).toEqual([]);
  expect(hidden.meta.aliasMatch.status).toBe('none');
  await f.alias('本公司手套', f.second.id);
  result = await (await f.list('procurement', f.a.id, '本公司手套')).json();
  expect(result.meta.aliasMatch).toEqual({
    status: 'unique',
    skuId: f.first.id,
  });
  const ambiguous = await (
    await f.list('requisitions', f.a.id, '本公司手套')
  ).json();
  expect(ambiguous.meta.aliasMatch).toEqual({
    status: 'ambiguous',
    skuId: null,
  });
  await f.alias('本公司手套', f.name.id, f.a.id, 'names');
  expect(
    (await (await f.list('procurement', f.a.id, '本公司手套')).json()).meta
      .aliasMatch.status,
  ).toBe('ambiguous');
  expect(
    (
      await (
        await f.admin.fetch(
          '/materials/catalog?q=' + encodeURIComponent('本公司手套'),
        )
      ).json()
    ).data.map((row: { id: string }) => row.id),
  ).toEqual([f.second.id]);
  const detail = await (
    await f.member.session.fetch(
      `/procurement/materialOptions/${f.first.id}?subjectId=${f.a.id}`,
    )
  ).json();
  expect(detail.data.packages[0].revision).toBe(f.pack.version);
  expect(JSON.stringify(detail)).not.toContain('仅其他公司');
});

test('previews exact packaging and unknown demand without creating business facts', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.grant();
  const before = {
    requests: await database.repository('materialRequests').count(),
    audits: await database.repository('materialAudit').count(),
  };
  const result = await (
    await f.select({
      ...f.known,
      unitId: String(f.box.id),
      unitRuleId: f.pack.id,
    })
  ).json();
  expect(result.data).toMatchObject({
    identificationStatus: 'identified',
    requestedQuantity: '10',
    baseQuantity: '120',
    unitRuleRevision: f.pack.version,
    skuRevision: f.first.version,
    numeratorSnapshot: '12',
  });
  expect(materialSelectionOutput.safeParse(result.data).success).toBe(true);
  expect(
    (
      await f.select({
        ...f.known,
        quantity: '1.5',
        unitId: String(f.box.id),
        unitRuleId: f.pack.id,
      })
    ).status,
  ).toBe(400);
  expect(
    (await f.select({ ...f.known, unitId: String(f.box.id) })).status,
  ).toBe(400);
  expect(
    (
      await f.select({
        ...f.known,
        skuId: f.nonStock.id,
        unitId: String(f.box.id),
        unitRuleId: f.pack.id,
      })
    ).status,
  ).toBe(400);
  expect((await f.select({ ...f.known, unitId: String(f.kg.id) })).status).toBe(
    400,
  );
  expect(
    (
      await f.select({
        ...f.known,
        quantity: '999999999999999999',
        unitId: String(f.box.id),
        unitRuleId: f.pack.id,
      })
    ).status,
  ).toBe(400);
  const unknown = {
    kind: 'unknown',
    subjectId: f.a.id,
    originalName: '原始砂石名称',
    originalSpecification: '粒径待确认',
    requestedUnitText: '立方米',
    quantity: '3.00',
  };
  const response = await f.select(unknown);
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({
    identificationStatus: 'unidentified',
    originalName: unknown.originalName,
    originalSpecification: unknown.originalSpecification,
    requestedUnitText: '立方米',
    requestedQuantity: '3',
    skuId: null,
    baseQuantity: null,
  });
  expect(
    (await f.select({ ...unknown, managementMode: 'nonStock' })).status,
  ).toBe(400);
  expect((await f.select({ ...unknown, subjectId: f.b.id })).status).toBe(404);
  expect(await database.repository('materialRequests').count()).toBe(
    before.requests,
  );
  expect(await database.repository('materialAudit').count()).toBe(
    before.audits,
  );
});

test('does not broaden missing action scopes using unrelated material permissions', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.authz.permissionSets.assign({
    permissionSet: 'materials-maintainer',
    subject: { type: 'user', id: f.member.user.id },
  });
  await f.grant('procurement', [f.a.id], ['materialSubjectSettings']);
  const response = await f.list();
  expect(response.status).toBe(403);
  expect((await f.select(f.known)).ok).toBe(false);
  expect((await f.list('procurement', f.b.id)).status).toBe(404);
});

test('joins material writes, lifecycle transitions and selection validation to the caller transaction', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  const materials = testApp.application.container.resolve(materialServiceToken);
  const selections = testApp.application.container.resolve(
    supplyChainMaterialServiceToken,
  );
  const policies: MaterialPolicies = Object.fromEntries(
    [
      ...Object.values(materialTables),
      'orgSubjects',
      'orgUnits',
      'orgPositions',
    ].map((table) => [
      table,
      { read: true, create: true, update: true, delete: false },
    ]),
  );
  const actor = { id: 'isolated-transaction-actor' };
  const auditCount = await database.repository('materialAudit').count();
  const transitionCount = await database
    .repository('lifecycleTransitions')
    .count();
  const code = `ROLLBACK-${randomUUID().slice(0, 8)}`;
  await expect(
    database.transaction(async (c) => {
      const request = await materials.saveInTransaction(
        c,
        'requests',
        {
          code,
          name: 'Source transaction test',
          subjectId: f.a.id,
          specification: 'Known source spec',
          usage: 'Rollback verification',
        },
        actor,
        policies,
      );
      await materials.fireInTransaction(
        c,
        'requests',
        String(request.id),
        'submit',
        {
          version: Number(request.lifecycleVersion),
          requestKey: randomUUID(),
          reason: 'Shared transaction',
        },
        actor,
        policies,
      );
      const preview = await selections.resolveSelectionInTransaction(
        c,
        'procurement',
        f.known,
        policies,
      );
      expect(preview.baseQuantity).toBe('10');
      throw new Error('Injected source write failure');
    }),
  ).rejects.toThrow('Injected source write failure');
  expect(
    await database.repository('materialRequests').exists({ filter: { code } }),
  ).toBe(false);
  expect(await database.repository('materialAudit').count()).toBe(auditCount);
  expect(await database.repository('lifecycleTransitions').count()).toBe(
    transitionCount,
  );
});

test('uses the seeded own-company role only after real account binding and effective employment', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  const assignment = await f.authz.permissionSets.assign({
    permissionSet: 'procurement-material-selector',
    subject: { type: 'user', id: f.member.user.id },
  });
  expect((await f.list()).status).toBe(404);
  const employee = await f.create('/people/employees', {
    code: `A2-E-${randomUUID().slice(0, 8)}`,
    name: 'Bound A2 employee',
    subjectId: f.a.id,
    data: { accountId: f.member.user.id },
  });
  expect((await f.list()).status).toBe(404);
  const department = await f.create('/organization/units', {
    code: `A2-D-${randomUUID().slice(0, 8)}`,
    name: 'A2 department',
    subjectId: f.a.id,
    type: 'department',
  });
  const position = await f.create('/organization/positions', {
    code: `A2-P-${randomUUID().slice(0, 8)}`,
    name: 'A2 requester position',
    unitId: department.id,
  });
  let change = await f.create('/people/changes', {
    code: `A2-ENTRY-${randomUUID().slice(0, 8)}`,
    name: 'Effective A2 entry',
    personId: employee.id,
    data: {
      type: 'entry',
      effectiveDate: businessDate(),
      targetSubjectId: f.a.id,
      targetPositionId: position.id,
      explanation: 'Isolated employment evidence',
    },
  });
  for (const transition of ['submit', 'approve']) {
    const response = await send(f.admin, `/people/changes/${change.id}/fire`, {
      transition,
      version: change.lifecycleVersion,
      requestId: randomUUID(),
      reason: 'Isolated employment approval',
      input: {},
    });
    const payload = await response.json();
    expect(response.status).toBe(200);
    change = payload.data;
  }
  expect(change.status).toBe('effective');
  expect((await f.list()).status).toBe(200);
  expect((await f.list('procurement', f.b.id)).status).toBe(404);
  expect((await f.member.session.fetch('/people/employees')).status).toBe(403);
  await f.authz.permissionSets.revoke(assignment.id);
  expect((await f.list()).status).toBe(403);
});

test('initializes selector defaults idempotently and preserves administrator configuration', async ({
  database,
}) => {
  const repository = database.repository.bind(database);
  const key = 'requisitions-material-selector';
  const original = await repository('authorizationPermissionSets').findOne({
    filter: { key },
  });
  expect(original).toBeTruthy();
  await repository('authorizationPermissionSets').updateOne({
    filter: { key },
    values: { title: 'Administrator selection title' },
  });
  const count = await repository('authorizationPermissionSets').count();
  await selectorDefaults.run({ repository });
  await selectorDefaults.run({ repository });
  const after = await repository('authorizationPermissionSets').findOne({
    filter: { key },
  });
  expect(after!.title).toBe('Administrator selection title');
  expect(after!.grants).toEqual(original!.grants);
  expect(await repository('authorizationPermissionSets').count()).toBe(count);
});

test('keeps large candidate ID scopes bounded in SQL depth and excludes every unrelated SKU', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  const ids = [...Array.from({ length: 2000 }, () => randomUUID()), f.first.id];
  const rows = await database.repository('materialSkus').findMany({
    filter: (filter) => materialIdFilter(filter, 'id', ids),
    limit: 10,
  });
  expect(rows.map((row) => row.id)).toEqual([f.first.id]);
  expect(
    await database
      .repository('materialSkus')
      .count({ filter: (filter) => materialIdFilter(filter, 'id', []) }),
  ).toBe(0);
});

test('preserves catalog domain errors through the business material API', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  await f.grant();
  const service = testApp.application.container.resolve(materialServiceToken);
  const query = vi
    .spyOn(service, 'catalog')
    .mockRejectedValueOnce(new MaterialError('MATERIAL_SEARCH_TOO_BROAD', 'q'));
  try {
    const response = await f.list('procurement', f.a.id, 'broad');
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({
      domain: 'materials',
      reason: 'MATERIAL_SEARCH_TOO_BROAD',
    });
  } finally {
    query.mockRestore();
  }
});

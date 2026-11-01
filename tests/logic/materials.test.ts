// @vitest-environment node
import { randomUUID, randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { createStandaloneServer } from '../../server/standalone.js';
import categoryGrantRemoval from '../../database/main/seeds/202610170003_remove_material_category_grants.js';
import {
  findUndeclaredApiRoutes,
  findApiDocumentSchemaProblems,
  apiDocsToken,
} from '@nocobase/app-server/router';

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

test('removes retired category grants idempotently while preserving custom scopes and unrelated configuration', async ({
  database,
}) => {
  const id = `custom-${randomUUID()}`;
  const untouched = {
    resource: { type: 'page', id: 'people-employees' },
    actions: [{ action: 'access' }],
  };
  await database.repository('authorizationPermissionSets').createOne({
    values: {
      id,
      key: id,
      title: 'Custom material role',
      createdAt: new Date(),
      updatedAt: new Date(),
      grants: [
        untouched,
        {
          resource: { type: 'page', id: 'warehouse-material-categories' },
          actions: [{ action: 'access' }],
        },
        {
          resource: { type: 'composite', id: 'materials.categories' },
          actions: [{ action: 'update' }],
        },
        {
          resource: { type: 'composite', id: 'materials.skus' },
          actions: [
            {
              action: 'read',
              policy: {
                type: 'composite',
                scopes: {
                  skus: 'allRecords',
                  categories: 'allRecords',
                  tags: '',
                },
              },
            },
          ],
        },
        {
          resource: { type: 'composite', id: 'procurement.materials' },
          actions: [
            {
              action: 'read',
              policy: {
                type: 'composite',
                scopes: {
                  materialCategories: 'allRecords',
                  orgSubjects: 'supplyChain.ownSubject',
                  materialSubjectSettings: 'supplyChain.ownCompany',
                },
              },
            },
          ],
        },
      ],
    },
  });
  await categoryGrantRemoval.run({
    repository: (name) => database.repository(name),
  });
  const result = await database
    .repository('authorizationPermissionSets')
    .findOne({ filter: { id } });
  const grants = (
    typeof result!.grants === 'string'
      ? JSON.parse(result!.grants)
      : result!.grants
  ) as {
    resource: { id: string };
    actions: { policy?: { scopes: Record<string, unknown> } }[];
  }[];
  expect(grants).toHaveLength(3);
  expect(grants[0]).toEqual(untouched);
  expect(grants[1].actions[0].policy?.scopes).toEqual({
    skus: 'allRecords',
    tags: '',
    tagLinks: 'allRecords',
  });
  expect(grants[2].actions[0].policy?.scopes).toEqual({
    orgSubjects: 'supplyChain.ownSubject',
    materialSubjectSettings: 'supplyChain.ownCompany',
  });
  await categoryGrantRemoval.run({
    repository: (name) => database.repository(name),
  });
  const repeated = await database
    .repository('authorizationPermissionSets')
    .findOne({ filter: { id } });
  expect(repeated).toEqual(result);
});

test('protects catalog and maintenance separately and preserves permission revocation', async ({
  testApp,
  request,
}) => {
  expect((await request('/materials/catalog')).status).toBe(401);
  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const authz = testApp.application.container.resolve(authorizationToken);
  const email = `${randomUUID()}@example.test`,
    password = randomUUID();
  const user = await users.create({
    name: 'Material catalog reader',
    email,
    password,
  });
  const member = await signIn(testApp, { email, password });
  expect((await member.fetch('/materials/catalog')).status).toBe(403);
  const assigned = await authz.permissionSets.assign({
    permissionSet: 'materials-reader',
    subject: { type: 'user', id: user.id },
  });
  expect((await member.fetch('/materials/catalog')).status).toBe(200);
  expect((await member.fetch('/materials/skus')).status).toBe(403);
  expect((await member.fetch('/materials/requests')).status).toBe(403);
  expect((await member.fetch('/materials/history')).status).toBe(403);
  expect(
    (
      await member.fetch(
        `/materials/names/similar?name=${encodeURIComponent('法兰')}`,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await member.fetch(
        `/materials/names/code-suggestion?name=${encodeURIComponent('法兰')}`,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await member.fetch('/materials/names', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({ arbitraryState: 'active' }),
      })
    ).status,
  ).toBe(403);
  await authz.permissionSets.revoke(assigned.id);
  expect((await member.fetch('/materials/catalog')).status).toBe(403);
});

test('governs identity, units, aliases, request links, activation, history and replay atomically', async ({
  testApp,
  database,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const authz = testApp.application.container.resolve(authorizationToken);
  const email = `${randomUUID()}@example.test`,
    password = randomUUID();
  const user = await users.create({
    name: 'Independent material reviewer',
    email,
    password,
  });
  await authz.permissionSets.assign({
    permissionSet: 'materials-reviewer',
    subject: { type: 'user', id: user.id },
  });
  const reviewer = await signIn(testApp, { email, password });
  const send = (
    session: typeof admin,
    path: string,
    body: unknown,
    method = 'POST',
  ) =>
    session.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
  const create = async (kind: string, body: unknown) => {
    const response = await send(admin, `/materials/${kind}`, body);
    const data = await response.json();
    expect(response.status).toBe(201);
    return data.data;
  };
  const fire = async (
    session: typeof admin,
    kind: string,
    record: { id: string; lifecycleVersion: number },
    transition: string,
    extra = {},
  ) => {
    const response = await send(
      session,
      `/materials/${kind}/${record.id}/${transition}`,
      {
        version: record.lifecycleVersion,
        requestKey: randomUUID(),
        reason: 'Isolated verification',
        ...extra,
      },
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    return payload.data;
  };
  const template = await create('templates', {
    name: 'Pen specification',
    fields: [
      {
        key: 'color',
        title: 'Color',
        type: 'option',
        options: ['black', 'red'],
        required: true,
        identity: true,
      },
      {
        key: 'tip',
        title: 'Tip',
        type: 'number',
        unit: 'mm',
        required: true,
        identity: true,
      },
    ],
  });
  const name = await create('names', {
    name: 'Gel pen',
    templateId: template.id,
  });
  const unit = await database
    .repository('measureUnits')
    .findOne({ filter: { code: 'PEN' } });
  let sku = await create('skus', {
    name: 'Black gel pen 0.5 mm',
    materialNameId: name.id,
    baseUnitId: String(unit!.id),
    managementMode: 'stock',
    attributeValues: { color: 'black', tip: '0.50' },
  });
  expect(sku.attributeValues.tip).toBe('0.5');
  expect(
    (
      await send(admin, '/materials/skus', {
        name: 'Same identity under a different description',
        materialNameId: name.id,
        baseUnitId: String(unit!.id),
        managementMode: 'stock',
        attributeValues: { color: 'black', tip: '0.500' },
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await send(admin, '/materials/names', {
        name: 'Reject retired input',
        categoryId: randomUUID(),
      })
    ).status,
  ).toBe(400);
  expect((await admin.fetch('/materials/categories')).status).toBe(404);
  expect(
    (await admin.fetch(`/materials/catalog?categoryId=${randomUUID()}`)).status,
  ).toBe(400);
  sku = await fire(admin, 'skus', sku, 'submit');
  const denied = await send(admin, `/materials/skus/${sku.id}/approve`, {
    version: sku.lifecycleVersion,
    requestKey: randomUUID(),
    reason: 'Attempt self review',
  });
  expect(denied.ok).toBe(false);
  expect(
    (await database
      .repository('materialSkus')
      .findOne({ filter: { id: sku.id } }))!.status,
  ).toBe('pending');
  sku = await fire(reviewer, 'skus', sku, 'approve');
  const stale = await send(
    admin,
    `/materials/skus/${sku.id}`,
    { version: 1, reason: 'Stale draft', name: 'Do not overwrite' },
    'PATCH',
  );
  expect(stale.status).toBe(409);
  const box = await database
    .repository('measureUnits')
    .findOne({ filter: { code: 'BOX' } });
  let packaging = await create('unitRules', {
    name: '12 pens per box',
    skuId: sku.id,
    unitId: String(box!.id),
    numerator: '12',
    denominator: '1',
  });
  packaging = await fire(admin, 'unitRules', packaging, 'submit');
  await fire(reviewer, 'unitRules', packaging, 'approve');
  const kilograms = await database
    .repository('measureUnits')
    .findOne({ filter: { code: 'KG' } });
  expect(
    (
      await send(admin, '/materials/unitRules', {
        name: 'Invalid variable conversion',
        skuId: sku.id,
        unitId: String(kilograms!.id),
        numerator: '1',
        denominator: '1',
      })
    ).status,
  ).toBe(400);
  let alias = await create('references', {
    name: 'Signing instrument',
    targetKind: 'skus',
    targetId: sku.id,
    sourceType: 'alias',
  });
  alias = await fire(admin, 'references', alias, 'submit');
  const approvedAlias = await fire(reviewer, 'references', alias, 'approve');
  expect(
    (
      await send(
        admin,
        `/materials/references/${approvedAlias.id}`,
        {
          version: approvedAlias.version,
          reason: 'Confirmed mapping identity must remain fixed',
          name: 'A different source alias',
        },
        'PATCH',
      )
    ).ok,
  ).toBe(false);
  const catalog = await (
    await reviewer.fetch('/materials/catalog?q=Signing')
  ).json();
  expect(catalog.error).toBeUndefined();
  expect(catalog.data.map((item: { id: string }) => item.id)).toEqual([sku.id]);
  expect(catalog.data[0].createdBy).toBeUndefined();
  expect(catalog.data[0].identityKey).toBeUndefined();
  const detail = await (
    await reviewer.fetch(`/materials/catalog/${sku.id}`)
  ).json();
  expect(detail.data.packages[0].numerator).toBe('12');
  expect(detail.data.workflow).toBeUndefined();
  const groupResponse = await send(admin, '/organization/subjects', {
    code: 'MAT-GROUP',
    name: 'Material verification owner',
    type: 'group',
  });
  const group = (await groupResponse.json()).data;
  const companySetting = await create('subjectSettings', {
    name: 'Company purchase and sale availability',
    subjectId: group.id,
    skuId: sku.id,
    canPurchase: true,
    canSell: false,
  });
  const editedSetting = await send(
    admin,
    `/materials/subjectSettings/${companySetting.id}`,
    {
      version: companySetting.version,
      reason: 'Allow sales as well',
      canSell: true,
    },
    'PATCH',
  );
  expect(editedSetting.status).toBe(200);
  expect((await editedSetting.json()).data.canSell).toBe(true);

  let request = await create('requests', {
    name: 'Need a black gel pen',
    subjectId: group.id,
    specification: '0.5 mm',
    usage: 'Office',
  });
  request = await fire(admin, 'requests', request, 'submit');
  const maintainerEmail = `${randomUUID()}@example.test`,
    maintainerPassword = randomUUID();
  const maintainerUser = await users.create({
    name: 'Material maintainer',
    email: maintainerEmail,
    password: maintainerPassword,
  });
  await authz.permissionSets.assign({
    permissionSet: 'materials-maintainer',
    subject: { type: 'user', id: maintainerUser.id },
  });
  const maintainer = await signIn(testApp, {
    email: maintainerEmail,
    password: maintainerPassword,
  });
  const proposedResponse = await send(maintainer, '/materials/skus', {
    name: 'Requested red pen 1 mm',
    materialNameId: name.id,
    baseUnitId: String(unit!.id),
    managementMode: 'stock',
    attributeValues: { color: 'red', tip: '1' },
    requestId: request.id,
  });
  expect(proposedResponse.status).toBe(201);
  let proposed = (await proposedResponse.json()).data;
  proposed = await fire(maintainer, 'skus', proposed, 'submit');
  expect(
    (
      await send(admin, `/materials/skus/${proposed.id}/approve`, {
        version: proposed.lifecycleVersion,
        requestKey: randomUUID(),
        reason: 'Requester cannot approve the result',
      })
    ).ok,
  ).toBe(false);
  await fire(reviewer, 'skus', proposed, 'approve');
  const byAlias = await (await admin.fetch('/materials/skus?q=Signing')).json();
  expect(byAlias.data.map((item: { id: string }) => item.id)).toEqual([sku.id]);
  const ascending = await (
    await reviewer.fetch('/materials/catalog?orderBy=updatedAt')
  ).json();
  expect(ascending.data.map((item: { id: string }) => item.id)).toEqual([
    sku.id,
    proposed.id,
  ]);

  const tag = await create('tags', {
    name: 'Office and workshop',
    appliesTo: 'both',
  });
  const inherited = await create('tagLinks', {
    name: 'Shared name tag',
    tagId: tag.id,
    targetKind: 'names',
    targetId: name.id,
  });
  const direct = await create('tagLinks', {
    name: 'Specific SKU tag',
    tagId: tag.id,
    targetKind: 'skus',
    targetId: sku.id,
  });
  for (const endpoint of ['catalog', 'skus']) {
    const result = await (
      await admin.fetch(`/materials/${endpoint}?tagId=${tag.id}`)
    ).json();
    expect(result.meta.total).toBe(2);
    expect(new Set(result.data.map((item: { id: string }) => item.id))).toEqual(
      new Set([sku.id, proposed.id]),
    );
  }
  const taggedDetail = await (
    await reviewer.fetch(`/materials/catalog/${sku.id}`)
  ).json();
  expect(taggedDetail.data.tags).toHaveLength(1);
  expect(taggedDetail.data.tags[0]).toMatchObject({
    id: tag.id,
    inherited: false,
  });
  await fire(admin, 'tagLinks', inherited, 'deactivate');
  const specific = await (
    await reviewer.fetch(`/materials/catalog?tagId=${tag.id}`)
  ).json();
  expect(specific.data.map((item: { id: string }) => item.id)).toEqual([
    sku.id,
  ]);
  await fire(admin, 'tagLinks', direct, 'deactivate');
  await fire(admin, 'tags', tag, 'deactivate');
  const inactive = await (
    await reviewer.fetch(`/materials/catalog?tagId=${tag.id}`)
  ).json();
  expect(inactive.data).toEqual([]);
  expect(inactive.meta.total).toBe(0);

  const key = randomUUID();
  const resolveInput = {
    version: request.lifecycleVersion,
    requestKey: key,
    reason: 'Map to approved material',
    resolvedSkuId: sku.id,
  };
  expect(
    (
      await send(
        reviewer,
        `/materials/requests/${request.id}/resolve`,
        resolveInput,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await send(
        reviewer,
        `/materials/requests/${request.id}/resolve`,
        resolveInput,
      )
    ).status,
  ).toBe(200);
  expect(
    await database
      .repository('materialRequestLinks')
      .count({ filter: { requestId: request.id, relation: 'resolved' } }),
  ).toBe(1);
  expect(
    await database
      .repository('materialAudit')
      .count({ filter: { recordId: request.id, operation: 'resolve' } }),
  ).toBe(1);
  expect(
    (
      await send(admin, `/materials/units/${unit!.id}/deactivate`, {
        version: 0,
        requestKey: randomUUID(),
        reason: 'Still referenced',
      })
    ).status,
  ).toBe(400);
  expect(
    (await database
      .repository('measureUnits')
      .findOne({ filter: { id: String(unit!.id) } }))!.status,
  ).toBe('active');
  expect(findUndeclaredApiRoutes(testApp.application)).toEqual([]);
  const document = await testApp.application.container
    .resolve(apiDocsToken)
    .getDocument();
  expect(findApiDocumentSchemaProblems(document)).toEqual([]);
});

test('enforces company scopes on writes and protects organization references', async ({
  testApp,
  database,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS),
    users = testApp.application.container.resolve(
      userAdministrationServiceToken,
    ),
    authz = testApp.application.container.resolve(authorizationToken);
  const send = (
    session: typeof admin,
    path: string,
    body: unknown,
    method = 'POST',
  ) =>
    session.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
  const create = async (path: string, body: unknown) => {
    const response = await send(admin, path, body);
    const value = await response.json();
    expect(response.status).toBe(201);
    return value.data;
  };
  const a = await create('/organization/subjects', {
      code: 'MAT-A',
      name: 'Material company A',
      type: 'group',
    }),
    b = await create('/organization/subjects', {
      code: 'MAT-B',
      name: 'Material company B',
      type: 'group',
    });
  const unit = await create('/organization/units', {
      code: 'MAT-DEPT',
      name: 'Warehouse department',
      subjectId: a.id,
      type: 'department',
    }),
    position = await create('/organization/positions', {
      code: 'MAT-POS',
      name: 'Warehouse manager',
      unitId: unit.id,
    });
  const warehouse = await create('/materials/warehouses', {
    code: 'MAIN',
    name: 'Main warehouse',
    subjectId: a.id,
    responsiblePositionId: position.id,
  });
  await create('/materials/warehouses', {
    code: 'MAIN',
    name: 'Other company main warehouse',
    subjectId: b.id,
  });
  expect(
    (
      await send(
        admin,
        `/organization/positions/${position.id}`,
        {
          version: position.version,
          reason: 'Still owns warehouse',
          status: 'inactive',
        },
        'PATCH',
      )
    ).ok,
  ).toBe(false);
  const email = `${randomUUID()}@example.test`,
    password = randomUUID(),
    user = await users.create({
      name: 'Scoped warehouse user',
      email,
      password,
    });
  const role = await authz.permissionSets.create({
    key: `material-scope-${randomUUID()}`,
    title: 'Scoped material verification',
    grants: [
      {
        resource: { type: 'composite', id: 'materials.warehouses' },
        actions: ['read', 'update'].map((action) => ({
          action,
          policy: {
            type: 'composite',
            scopes: {
              warehouses: {
                type: 'recordAccess',
                key: 'materials.companies',
                params: { subjectIds: [a.id] },
              },
              orgSubjects: 'allRecords',
              orgUnits: 'allRecords',
              orgPositions: 'allRecords',
            },
          },
        })),
      },
    ],
  });
  await authz.permissionSets.assign({
    permissionSet: role.key,
    subject: { type: 'user', id: user.id },
  });
  const member = await signIn(testApp, { email, password });
  const list = await (await member.fetch('/materials/warehouses')).json();
  expect(list.data.map((v: { id: string }) => v.id)).toEqual([warehouse.id]);
  const count = await database.repository('warehouses').count();
  const audits = await database.repository('materialAudit').count();
  expect(
    (
      await send(member, '/materials/warehouses', {
        name: 'Out of company',
        subjectId: b.id,
      })
    ).status,
  ).toBe(403);
  expect(await database.repository('warehouses').count()).toBe(count);
  expect(await database.repository('materialAudit').count()).toBe(audits);
  const foreign = await database
    .repository('warehouses')
    .findOne({ filter: { subjectId: b.id } });
  expect(
    (await member.fetch(`/materials/warehouses/${foreign!.id}`)).status,
  ).toBe(404);
  const options = await (
    await member.fetch(
      `/materials/options?kind=warehouses&selectedId=${warehouse.id}`,
    )
  ).json();
  expect(options.error).toBeUndefined();
  expect(
    (
      await send(
        admin,
        `/organization/subjects/${b.id}`,
        {
          version: b.version,
          reason: 'Warehouse reference',
          status: 'inactive',
        },
        'PATCH',
      )
    ).ok,
  ).toBe(false);
});

test('suggests existing standard names before a near duplicate is created', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const create = async (name: string) => {
    const response = await admin.fetch('/materials/names', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ name }),
    });
    expect(response.status).toBe(201);
    return (await response.json()).data as { id: string; name: string };
  };
  const suggest = async (name: string, query = '') => {
    const response = await admin.fetch(
      `/materials/names/similar?name=${encodeURIComponent(name)}${query}`,
    );
    expect(response.status).toBe(200);
    return (await response.json()).data as {
      rows: { id: string; name: string; reason: string; status: string }[];
    };
  };
  expect(
    (
      await request(
        `/materials/names/similar?name=${encodeURIComponent('法兰')}`,
      )
    ).status,
  ).toBe(401);
  const flange = await create('碳钢法兰 DN50');
  await create('不锈钢法兰 DN80');
  await create('碳钢弯头 DN50');

  const same = await suggest('碳钢 法兰-DN50');
  expect(same.rows[0]).toMatchObject({
    id: flange.id,
    reason: 'same',
    status: 'active',
  });

  const contained = await suggest('碳钢法兰');
  expect(contained.rows.map((row) => row.name)).toContain('碳钢法兰 DN50');

  const similar = await suggest('碳钢法兰 DN65');
  expect(similar.rows.map((row) => row.name)).toContain('碳钢法兰 DN50');
  expect(similar.rows.map((row) => row.name)).not.toContain('碳钢弯头 DN50');

  const excluded = await suggest('碳钢法兰 DN50', `&excludeId=${flange.id}`);
  expect(excluded.rows.map((row) => row.id)).not.toContain(flange.id);

  expect(
    (await admin.fetch('/materials/names/similar?name=%20%20')).status,
  ).toBe(400);
});

test('derives a standard-name code from uppercase name initials', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const suggest = async (name: string) => {
    const response = await admin.fetch(
      `/materials/names/code-suggestion?name=${encodeURIComponent(name)}`,
    );
    expect(response.status).toBe(200);
    return (await response.json()).data as { code: string };
  };
  const create = async (name: string, code?: string) => {
    const response = await admin.fetch('/materials/names', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ name, code }),
    });
    expect(response.status).toBe(201);
    return (await response.json()).data as { code: string; name: string };
  };

  expect(
    (
      await request(
        `/materials/names/code-suggestion?name=${encodeURIComponent('法兰')}`,
      )
    ).status,
  ).toBe(401);

  expect(await suggest('铬钼法兰 DN150')).toEqual({ code: 'GMFLDN150' });
  expect(await create('铬钼法兰 DN150')).toMatchObject({
    name: '铬钼法兰 DN150',
    code: 'GMFLDN150',
  });
  // A taken abbreviation gets a numeric suffix instead of colliding.
  expect(await suggest('铬钼法兰 DN150')).toEqual({ code: 'GMFLDN150-2' });
  expect(await create('铬钼法兰 DN150 备用', 'GMFLDN150-2')).toMatchObject({
    code: 'GMFLDN150-2',
  });

  expect(await suggest('Stainless Steel Flange')).toEqual({ code: 'SSF' });
  expect(await create('Stainless Steel Flange')).toMatchObject({ code: 'SSF' });

  expect(await suggest('钛合金法兰 DN100')).toEqual({ code: 'THJFLDN100' });

  expect(
    (
      await admin.fetch(
        `/materials/names/code-suggestion?name=${encodeURIComponent('  ')}`,
      )
    ).status,
  ).toBe(400);
});

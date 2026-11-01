import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DatabaseManager } from '@nocobase/db';
import type { TestApp } from '@nocobase/app-testing/server';
import { z } from 'zod';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn as rawSignIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { PurchaseContent } from '../../server/providers/purchase-request-model.js';
import { businessDate } from '../../server/providers/business-date.js';
import {
  purchaseActions,
  purchaseReadColumns,
  purchaseReferenceColumns,
  purchaseCompanyTables,
} from '../../server/providers/purchase-request-resources.js';

// Heterogeneous fixture endpoints are asserted below; retain their JSON object shape here.
const testPayload = z.record(z.string(), z.any());
type TestResponse = Omit<Response, 'json'> & {
  json(): Promise<z.infer<typeof testPayload>>;
};
export async function signIn(...args: Parameters<typeof rawSignIn>) {
  const session = await rawSignIn(...args);
  return {
    ...session,
    fetch: async (path: string, init?: RequestInit): Promise<TestResponse> => {
      const response = await session.fetch(path, init),
        read = response.json.bind(response);
      Object.defineProperty(response, 'json', {
        value: async () => testPayload.parse(await read()),
      });
      return response as TestResponse;
    },
  };
}
type Session = Awaited<ReturnType<typeof signIn>>;
export const send = (
  session: Session,
  path: string,
  body: unknown,
  method = 'POST',
  origin = 'http://localhost',
) =>
  session.fetch(path, {
    method,
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
export const mutation = (row: {
  revision: number;
  lifecycleVersion: number;
}) => ({
  version: row.revision,
  lifecycleVersion: row.lifecycleVersion,
  requestKey: randomUUID(),
  reason: 'Isolated purchase verification',
});

const sendWithOrigin = send;
export async function fixture(
  app: TestApp,
  db: DatabaseManager,
  origin = 'http://localhost',
) {
  const send = (
    session: Session,
    path: string,
    body: unknown,
    method = 'POST',
  ) => sendWithOrigin(session, path, body, method, origin);
  const admin = await signIn(app, DEFAULT_ADMIN_CREDENTIALS),
    authz = app.application.container.resolve(authorizationToken),
    users = app.application.container.resolve(userAdministrationServiceToken);
  const create = async (path: string, body: unknown) => {
    const r = await send(admin, path, body);
    const v = await r.json();
    assert.equal(
      r.status,
      201,
      String(v.error?.reason ?? 'Fixture create failed'),
    );
    return v.data;
  };
  const a = await create('/organization/subjects', {
    code: randomUUID(),
    name: 'Purchase company A',
    type: 'group',
  });
  const b = await create('/organization/subjects', {
    code: randomUUID(),
    name: 'Purchase company B',
    type: 'group',
  });
  const unit = await create('/organization/units', {
    code: randomUUID(),
    name: 'Purchase department',
    type: 'department',
    subjectId: a.id,
  });
  const position = await create('/organization/positions', {
    code: randomUUID(),
    name: 'Purchase position',
    unitId: unit.id,
  });
  const person = async (name: string) => {
    const password = randomUUID(),
      user = await users.create({
        name,
        email: `${randomUUID()}@example.test`,
        password,
      });
    const session = await signIn(app, { email: user.email!, password });
    const employee = await create('/people/employees', {
      code: randomUUID(),
      name,
      subjectId: a.id,
      data: { accountId: user.id },
    });
    for (const table of ['personnelEmployments', 'personnelAssignments'])
      await db.repository(table).createOne({
        values: {
          id: randomUUID(),
          code: randomUUID(),
          name,
          subjectId: a.id,
          personId: employee.id,
          positionId: table === 'personnelAssignments' ? position.id : null,
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
  };
  const applicant = await person('Applicant'),
    reviewer = await person('Reviewer'),
    agent = await person('Agent');
  const grant = async (
    userId: string,
    actions: readonly string[] = purchaseActions,
    companies = [a.id],
    resource = 'procurement.requests',
  ) => {
    const scopes = Object.fromEntries(
      Object.keys(
        resource === 'procurement.settings'
          ? purchaseReferenceColumns
          : purchaseReadColumns,
      ).map((table) => [
        table,
        purchaseCompanyTables.includes(table)
          ? {
              type: 'recordAccess',
              key: 'procurement.requestCompanies',
              params: { subjectIds: companies },
            }
          : table === 'orgSubjects'
            ? {
                type: 'recordAccess',
                key: 'supplyChain.subjects',
                params: { subjectIds: companies },
              }
            : 'allRecords',
      ]),
    );
    const role = await authz.permissionSets.create({
      key: randomUUID(),
      title: 'Isolated purchase grant',
      grants: [
        {
          resource: { type: 'composite', id: resource },
          actions: actions.map((action) => ({
            action,
            policy: { type: 'composite', scopes },
          })),
        },
      ],
    });
    return authz.permissionSets.assign({
      permissionSet: role.key,
      subject: { type: 'user', id: userId },
    });
  };
  await authz.permissionSets.assign({
    permissionSet: 'procurement-source-requester',
    subject: { type: 'user', id: applicant.user.id },
  });
  await authz.permissionSets.assign({
    permissionSet: 'procurement-requester',
    subject: { type: 'user', id: applicant.user.id },
  });
  await authz.permissionSets.assign({
    permissionSet: 'procurement-request-reviewer',
    subject: { type: 'user', id: reviewer.user.id },
  });
  const line = () => ({
    id: randomUUID(),
    selection: {
      kind: 'unknown' as const,
      subjectId: a.id,
      originalName: '原始手套',
      originalSpecification: '耐磨规格',
      requestedUnitText: '副',
      quantity: '20',
    },
    originalName: '原始手套',
    originalSpecification: '耐磨规格',
    usage: '',
    notes: '',
  });
  const content = (): PurchaseContent => ({
    subjectId: a.id,
    requesterEmployeeId: applicant.employee.id,
    requestingUnitId: unit.id,
    usage: 'Maintenance',
    neededOn: businessDate(),
    suggestedSupplierId: null as string | null,
    projectId: null,
    notes: '',
    lines: [line()],
  });
  const draft = async (body = content(), session = applicant.session) => {
    const r = await send(session, '/procurement/requests', {
      content: body,
      requestKey: randomUUID(),
    });
    const v = await r.json();
    assert.equal(
      r.status,
      201,
      String(v.error?.reason ?? 'Fixture create failed'),
    );
    return v.data;
  };
  const fire = async (
    row: { id: string; revision: number; lifecycleVersion: number },
    transition: string,
    session = applicant.session,
  ) => {
    const r = await send(
      session,
      `/procurement/requests/${row.id}/${transition}`,
      mutation(row),
    );
    const v = await r.json();
    assert.equal(
      r.status,
      200,
      String(v.error?.reason ?? 'Fixture action failed'),
    );
    return v.data;
  };
  const rules = (ids = [reviewer.user.id], allowParallelGovernance = true) => ({
    reviewerSelections: ids.map((id, group) => ({
      group: group + 1,
      type: 'user',
      referenceId: id,
    })),
    allowParallelGovernance,
    requireProject: false,
  });
  const saveRules = async (
    values = rules(),
    version = 0,
    requestKey = randomUUID(),
  ) => {
    const r = await send(
      admin,
      '/procurement/settings',
      { subjectId: a.id, values, version, requestKey },
      'PUT',
    );
    const v = await r.json();
    assert.equal(
      r.status,
      200,
      String(v.error?.reason ?? 'Fixture action failed'),
    );
    return v.data;
  };
  return {
    admin,
    authz,
    users,
    a,
    b,
    unit,
    position,
    person,
    applicant,
    reviewer,
    agent,
    grant,
    line,
    content,
    create,
    draft,
    fire,
    rules,
    saveRules,
  };
}

export async function purchaseMaterial(
  f: Awaited<ReturnType<typeof fixture>>,
  db: DatabaseManager,
  origin = 'http://localhost',
) {
  const send = (
    session: Session,
    path: string,
    body: unknown,
    method = 'POST',
  ) => sendWithOrigin(session, path, body, method, origin);
  await f.authz.permissionSets.assign({
    permissionSet: 'materials-reviewer',
    subject: { type: 'user', id: f.reviewer.user.id },
  });
  const activate = async (
    kind: string,
    initial: { id: string; lifecycleVersion: number },
  ) => {
    let row = initial;
    for (const transition of ['submit', 'approve']) {
      const response = await send(
        transition === 'submit' ? f.admin : f.reviewer.session,
        `/materials/${kind}/${row.id}/${transition}`,
        {
          version: row.lifecycleVersion,
          requestKey: randomUUID(),
          reason: 'Isolated reference qualification',
        },
      );
      assert.equal(response.status, 200);
      row = (await response.json()).data;
    }
    return row;
  };
  const template = await f.create('/materials/templates', {
    name: 'Reference specification',
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
  const name = await f.create('/materials/names', {
    name: 'Reference gloves',
    templateId: template.id,
  });
  const each = await db
    .repository('measureUnits')
    .findOne({ filter: { code: 'EA' } });
  const box = await db
    .repository('measureUnits')
    .findOne({ filter: { code: 'BOX' } });
  const sku = await activate(
    'skus',
    await f.create('/materials/skus', {
      name: 'Reference model A',
      materialNameId: name.id,
      baseUnitId: String(each!.id),
      managementMode: 'stock',
      attributeValues: { model: 'A' },
    }),
  );
  const admission = await f.create('/materials/subjectSettings', {
    name: 'Reference company admission',
    subjectId: f.a.id,
    skuId: sku.id,
    canPurchase: true,
    canSell: false,
  });
  const pack = await activate(
    'unitRules',
    await f.create('/materials/unitRules', {
      name: 'Twelve each per box',
      skuId: sku.id,
      unitId: String(box!.id),
      numerator: '12',
      denominator: '1',
    }),
  );
  const known = {
    ...f.line(),
    selection: {
      kind: 'known' as const,
      subjectId: f.a.id,
      skuId: sku.id,
      unitId: String(box!.id),
      unitRuleId: pack.id,
      quantity: '2',
    },
  };
  return {
    template,
    name,
    each: each!,
    box: box!,
    sku,
    admission,
    pack,
    content: { ...f.content(), lines: [known] },
  };
}

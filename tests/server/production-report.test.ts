// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { databaseManagerToken } from '@nocobase/db';
import { createStandaloneServer } from '../../server/standalone.js';
import { businessDate } from '../../server/providers/business-date.js';
import { resolveProductionIdentity } from '../../server/providers/production-identity.js';

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

test('fills one shift report with attendance, downtime and overtime', async ({
  testApp,
  request,
}) => {
  expect((await request('/production/report-context')).status).toBe(401);
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
  const db = testApp.application.container.resolve(databaseManagerToken);

  const subject = await create('/organization/subjects', {
    code: `PRD-${randomUUID().slice(0, 6)}`,
    name: 'Report test company',
    type: 'group',
  });
  const unit = await create('/organization/units', {
    code: `PRD-U-${randomUUID().slice(0, 6)}`,
    name: 'Report test line',
    type: 'department',
    subjectId: subject.id,
  });
  const equipmentId = randomUUID();
  await db.repository('prdEquipment').createOne({
    values: {
      id: equipmentId,
      subjectId: subject.id,
      unitId: unit.id,
      code: `EQ-${randomUUID().slice(0, 6)}`,
      name: 'Crusher',
      criticality: 'normal',
      status: 'active',
      version: 1,
      createdBy: 'test',
      updatedBy: 'test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never,
  });
  const position = await create('/organization/positions', {
    code: `PRD-P-${randomUUID().slice(0, 6)}`,
    name: 'Shift lead',
    unitId: unit.id,
    productionRole: 'production',
  });
  const userId = randomUUID();
  const personId = randomUUID();
  const now = new Date().toISOString();
  await db.repository('personnelEmployees').createOne({
    values: {
      id: personId,
      code: `PRD-E-${randomUUID().slice(0, 6)}`,
      name: 'Li Si',
      status: 'active',
      lifecycleVersion: 0,
      createdBy: 'test',
      accountId: userId,
      subjectId: subject.id,
      data: { accountId: userId },
      createdAt: now,
      updatedAt: now,
    },
  });
  for (const table of ['personnelEmployments', 'personnelAssignments'])
    await db.repository(table).createOne({
      values: {
        id: randomUUID(),
        code: `PRD-${randomUUID().slice(0, 6)}`,
        name: 'Li Si',
        status: 'active',
        lifecycleVersion: 0,
        createdBy: 'test',
        data: {
          type: table === 'personnelAssignments' ? 'primary' : 'employee',
          startDate: '2020-01-01',
          endDate: null,
        },
        createdAt: now,
        updatedAt: now,
        subjectId: subject.id,
        personId,
        positionId: table === 'personnelAssignments' ? position.id : null,
      },
    });

  const identity = await resolveProductionIdentity(db, 'Asia/Shanghai', {
    type: 'user',
    id: userId,
  });
  expect(identity.reason).toBeNull();
  expect(identity.employee).toMatchObject({ id: personId, name: 'Li Si' });
  expect(identity.company).toMatchObject({ id: subject.id });
  expect(identity.position).toMatchObject({ id: position.id });
  expect(identity.units).toHaveLength(1);
  expect(identity.units[0]).toMatchObject({
    id: unit.id,
    positionId: position.id,
    primary: true,
  });
  expect(identity.defaultUnitId).toBe(unit.id);
  expect(identity.today).toBe(businessDate('Asia/Shanghai'));

  const unitOfMeasure = randomUUID();
  const materialName = randomUUID();
  const feedstockSku = randomUUID();
  const productSku = randomUUID();
  const warehouse = randomUUID();
  const insert = (table: string, values: Record<string, unknown>) =>
    db.repository(table).createOne({ values: values as never });
  const stamp = { createdAt: now, updatedAt: now, createdBy: 'test' };
  await insert('measureUnits', {
    id: unitOfMeasure,
    code: `T-${unitOfMeasure.slice(0, 6)}`,
    name: 'Ton',
    unitType: 'weight',
    precision: 6,
    status: 'active',
    revision: 0,
    lifecycleVersion: 0,
    notes: '',
    ...stamp,
  });
  await insert('materialNames', {
    id: materialName,
    code: `SLAG-${materialName.slice(0, 6)}`,
    name: 'Slag',
    status: 'active',
    revision: 0,
    lifecycleVersion: 0,
    notes: '',
    ...stamp,
  });
  for (const [id, code, name] of [
    [feedstockSku, `FS-${feedstockSku.slice(0, 6)}`, 'Raw slag'],
    [productSku, `PD-${productSku.slice(0, 6)}`, 'Gold concentrate'],
  ] as const)
    await insert('materialSkus', {
      id,
      code,
      name,
      materialNameId: materialName,
      baseUnitId: unitOfMeasure,
      managementMode: 'standard',
      attributeValues: {},
      identityKey: code,
      searchText: name,
      status: 'active',
      revision: 0,
      lifecycleVersion: 0,
      notes: '',
      ...stamp,
    });
  await insert('warehouses', {
    id: warehouse,
    code: `WH-${warehouse.slice(0, 6)}`,
    name: 'Metals warehouse',
    subjectId: subject.id,
    status: 'active',
    revision: 0,
    lifecycleVersion: 0,
    notes: '',
    ...stamp,
  });
  await insert('stockBalances', {
    id: randomUUID(),
    dimensionKey: `${subject.id}:warehouse:${warehouse}:${productSku}:qualified`,
    subjectId: subject.id,
    skuId: productSku,
    baseUnitId: unitOfMeasure,
    warehouseId: warehouse,
    quality: 'qualified',
    quantity: '50',
    reservedQuantity: '0',
    revision: 1,
    nonce: randomUUID(),
    updatedAt: now,
  });
  const configured = await send(
    `/production/setup/${unit.id}`,
    {
      status: 'active',
      materials: [
        { skuId: feedstockSku, role: 'feedstock', sortOrder: 0 },
        {
          skuId: productSku,
          role: 'product',
          defaultWarehouseId: warehouse,
          sortOrder: 10,
        },
      ],
    },
    'PUT',
  );
  expect(configured.status).toBe(200);

  const reportDate = businessDate('Asia/Shanghai');
  const query = `unitId=${unit.id}&reportDate=${reportDate}&shift=day`;
  const context = await admin.fetch('/production/report-context');
  expect(context.status).toBe(200);
  expect((await context.json()).data).toMatchObject({
    businessDate: reportDate,
  });

  const empty = await admin.fetch(`/production/report?${query}`);
  expect(empty.status).toBe(200);
  const emptyReport = (await empty.json()).data;
  expect(emptyReport.report).toBeNull();
  expect(emptyReport.attendance.rows).toHaveLength(1);
  expect(emptyReport.attendance.rows[0]).toMatchObject({
    personId,
    positionId: position.id,
    status: 'unrecorded',
  });

  const downtimeId = randomUUID();
  const overtimeId = randomUUID();
  const maintenanceId = randomUUID();
  const payload = {
    unitId: unit.id,
    reportDate,
    shift: 'day',
    report: {
      runtimeMinutes: 420,
      downtimeMinutes: 60,
      notes: 'Shift handover',
      materials: [
        { skuId: feedstockSku, role: 'feedstock', quantity: '120.5' },
        {
          skuId: productSku,
          role: 'product',
          quantity: '12.25',
          stockQuantity: '60',
        },
      ],
    },
    attendance: [
      {
        personId,
        positionId: position.id,
        status: 'present',
        overtimeMinutes: 90,
        overtimeContent: 'Cleared a jam',
      },
    ],
    downtime: [
      {
        id: downtimeId,
        startedAt: `${reportDate}T10:00:00+08:00`,
        category: 'equipment',
        impact: 'stop',
        description: 'Belt jam',
      },
    ],
    overtime: [
      {
        id: overtimeId,
        personId,
        hours: 1.5,
        type: 'temporary',
        reason: 'Cleared a jam',
        compensation: 'none',
      },
    ],
    maintenance: [
      {
        id: maintenanceId,
        equipmentId,
        kind: 'repair',
        description: 'Crusher belt replaced',
        assigneeName: 'Wang Wu',
      },
    ],
  };
  const saved = await send('/production/report', payload, 'PUT');
  const savedBody = await saved.json();
  expect(saved.status).toBe(200);
  const first = savedBody.data;
  expect(first.report).toMatchObject({
    reportDate,
    shift: 'day',
    status: 'draft',
    runtimeMinutes: 420,
    version: 1,
  });
  expect(first.report.materials).toMatchObject([
    {
      skuId: feedstockSku,
      role: 'feedstock',
      quantity: '120.5',
      stockQuantity: null,
    },
    {
      skuId: productSku,
      role: 'product',
      quantity: '12.25',
      stockQuantity: '60',
      bookQuantity: '50',
    },
  ]);
  expect(first.attendance.summary).toMatchObject({
    present: 1,
    unrecorded: 0,
    overtimeMinutes: 90,
  });
  expect(first.downtime.events).toHaveLength(1);
  expect(first.overtime.records).toHaveLength(1);
  expect(first.equipment).toHaveLength(1);
  expect(first.maintenance).toMatchObject([
    {
      id: maintenanceId,
      equipmentName: 'Crusher',
      type: 'repair',
      status: 'reported',
      description: 'Crusher belt replaced',
      assigneeName: 'Wang Wu',
    },
  ]);

  const stored = await db
    .repository('prdShiftReports')
    .findOne({ filter: { id: first.report.id } });
  expect(stored).toMatchObject({ sourceChannel: 'manual' });
  expect(typeof stored?.enteredBy).toBe('string');
  expect(stored?.enteredBy).not.toBe('');

  const again = await send(
    '/production/report',
    {
      ...payload,
      report: {
        ...payload.report,
        materials: [
          { skuId: feedstockSku, role: 'feedstock', quantity: '121' },
          {
            skuId: productSku,
            role: 'product',
            quantity: '12.25',
            stockQuantity: '60',
          },
        ],
        version: first.report.version,
      },
    },
    'PUT',
  );
  expect(again.status).toBe(200);
  const second = (await again.json()).data;
  expect(second.report).toMatchObject({ version: 2 });
  expect(
    second.report.materials.find(
      (material: { skuId: string }) => material.skuId === feedstockSku,
    ),
  ).toMatchObject({ quantity: '121' });
  expect(second.downtime.events).toHaveLength(1);
  expect(second.overtime.records).toHaveLength(1);
  expect(second.maintenance).toHaveLength(1);
  expect(second.attendance.rows[0].overtimeMinutes).toBe(90);

  const future = new Date(Date.now() + 86_400_000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
    .replaceAll('/', '-');
  const rejected = await send(
    '/production/report',
    { ...payload, reportDate: future, report: undefined },
    'PUT',
  );
  expect(rejected.status).toBe(400);
  expect(await rejected.text()).toContain('REPORT_DATE_FUTURE');
});

test('derives the reporter position from the employment chain', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const create = async (path: string, body: unknown) => {
    const response = await admin.fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    expect(response.status).toBe(201);
    return payload.data;
  };
  const db = testApp.application.container.resolve(databaseManagerToken);
  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const subject = await create('/organization/subjects', {
    code: `PRD-${randomUUID().slice(0, 6)}`,
    name: 'Identity test company',
    type: 'group',
  });
  const unit = await create('/organization/units', {
    code: `PRD-U-${randomUUID().slice(0, 6)}`,
    name: 'Identity test line',
    type: 'department',
    subjectId: subject.id,
  });
  const support = await create('/organization/positions', {
    code: `PRD-P-${randomUUID().slice(0, 6)}`,
    name: 'Accountant',
    unitId: unit.id,
    productionRole: 'support',
  });
  const password = randomUUID();
  const user = await users.create({
    name: 'Wang Wu',
    email: `${randomUUID()}@example.test`,
    password,
  });
  const employee = await create('/people/employees', {
    code: randomUUID(),
    name: 'Wang Wu',
    subjectId: subject.id,
    data: { accountId: user.id },
  });
  const now = new Date().toISOString();
  for (const table of ['personnelEmployments', 'personnelAssignments'])
    await db.repository(table).createOne({
      values: {
        id: randomUUID(),
        code: randomUUID(),
        name: 'Wang Wu',
        status: 'active',
        lifecycleVersion: 0,
        createdBy: 'test',
        data: {
          type: table === 'personnelAssignments' ? 'primary' : 'employee',
          startDate: '2020-01-01',
          endDate: null,
        },
        createdAt: now,
        updatedAt: now,
        subjectId: subject.id,
        personId: employee.id,
        positionId: table === 'personnelAssignments' ? support.id : null,
      },
    });

  const identity = await resolveProductionIdentity(db, 'Asia/Shanghai', {
    type: 'user',
    id: user.id,
  });
  expect(identity.reason).toBe('NO_PRODUCTION_POSITION');
  expect(identity.employee).toMatchObject({ id: employee.id });
  expect(identity.company).toMatchObject({ id: subject.id });
  expect(identity.position).toMatchObject({ id: support.id });
  expect(identity.units).toEqual([]);

  const unknown = await resolveProductionIdentity(db, 'Asia/Shanghai', {
    type: 'user',
    id: randomUUID(),
  });
  expect(unknown).toMatchObject({
    employee: null,
    company: null,
    position: null,
    units: [],
    reason: 'NO_EMPLOYEE',
  });
});

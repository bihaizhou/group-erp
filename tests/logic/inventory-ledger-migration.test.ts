// @vitest-environment node
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';
const subjectId = randomUUID(),
  warehouseId = randomUUID(),
  unitId = randomUUID(),
  nameId = randomUUID(),
  skuId = randomUUID(),
  documentId = randomUUID(),
  lineId = randomUUID(),
  balanceId = randomUUID(),
  postingId = randomUUID(),
  movementId = randomUUID(),
  now = new Date();
const master = {
  code: randomUUID(),
  name: 'Preserved inventory master',
  notes: 'Synthetic migration fixture',
  status: 'active',
  revision: 1,
  lifecycleVersion: 0,
  statusChangedAt: now,
  createdBy: 'migration-fixture',
  createdAt: now,
  updatedAt: now,
};
describeMigration('202610190001_inventory_ledger', {
  sources: [
    {
      packageName: 'group-erp',
      directory: path.resolve(
        import.meta.dirname,
        '../../database/main/migrations',
      ),
    },
  ],
  before: async ({ connection }) => {
    await connection.repository('orgSubjects').createOne({
      values: {
        id: subjectId,
        code: randomUUID(),
        name: 'Preserved company',
        type: 'group',
        status: 'active',
        sortOrder: 0,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
    await connection.repository('warehouses').createOne({
      values: {
        ...master,
        id: warehouseId,
        subjectId,
        responsiblePositionId: null,
      },
    });
    await connection.repository('measureUnits').createOne({
      values: { ...master, id: unitId, unitType: 'count', precision: 6 },
    });
    await connection
      .repository('materialNames')
      .createOne({ values: { ...master, id: nameId, templateId: null } });
    await connection.repository('materialSkus').createOne({
      values: {
        ...master,
        id: skuId,
        materialNameId: nameId,
        baseUnitId: unitId,
        managementMode: 'stock',
        attributeValues: {},
        identityKey: randomUUID(),
        searchText: 'Preserved inventory SKU',
      },
    });
  },
  up: async ({ connection, expectCollection }) => {
    for (const table of [
      'stockDocuments',
      'stockDocumentLines',
      'warehouseStockGates',
      'stockBalances',
      'stockPostings',
      'stockMovements',
      'stockReservations',
      'stockIssueFulfillments',
      'stockActionRequests',
    ])
      await expectCollection(table).toExist();
    await expectCollection('stockMovements').toHaveForeignKey(
      ['documentLineId', 'documentId', 'subjectId'],
      'stockDocumentLines',
      { referencedFields: ['id', 'documentId', 'subjectId'] },
    );
    await expectCollection('stockBalances').toHaveIndex(['dimensionKey'], {
      unique: true,
    });
    const head = {
      id: documentId,
      code: randomUUID(),
      subjectId,
      warehouseId,
      kind: 'initial',
      originalDocumentId: null,
      issueRequestId: null,
      status: 'approved',
      revision: 1,
      lifecycleVersion: 0,
      statusChangedAt: now,
      occurredOn: '2026-10-18',
      reason: 'Nonempty quantity ledger migration',
      notes: '',
      createdBy: 'migration-fixture',
      updatedBy: 'migration-fixture',
      createdAt: now,
      updatedAt: now,
      postedBy: null,
      postedAt: null,
    };
    await connection.repository('stockDocuments').createOne({ values: head });
    await connection.repository('stockDocumentLines').createOne({
      values: {
        id: lineId,
        documentId,
        subjectId,
        lineNo: 1,
        revision: 1,
        status: 'active',
        skuId,
        baseUnitId: unitId,
        unitId,
        unitRuleId: null,
        issueRequestLineId: null,
        issueRequestId: null,
        originalLineId: null,
        quantity: '9007199254740993.125',
        baseQuantity: '9007199254740993.125',
        numeratorSnapshot: '1',
        denominatorSnapshot: '1',
        quality: 'qualified',
        materialSnapshot: { name: 'Preserved SKU', baseUnitName: 'each' },
        notes: '',
      },
    });
    const balance = {
      id: balanceId,
      dimensionKey: `${subjectId}:warehouse:${warehouseId}:${skuId}:qualified`,
      subjectId,
      warehouseId,
      skuId,
      baseUnitId: unitId,
      quality: 'qualified',
      quantity: '9007199254740993.125',
      reservedQuantity: '9007199254740993.125',
      revision: 1,
      nonce: randomUUID(),
      updatedAt: now,
    };
    await connection.repository('stockBalances').createOne({ values: balance });
    for (const patch of [
      { reservedQuantity: '9007199254740993.125001' },
      { quantity: '-1' },
      { quantity: '0.0000001' },
      { quantity: '1e3' },
      { quality: 'other' },
      { dimensionKey: randomUUID() },
    ])
      await expect(
        connection.transaction((c) =>
          c
            .repository('stockBalances')
            .updateOne({ filter: { id: balanceId }, values: patch }),
        ),
      ).rejects.toThrow();
    await expect(
      connection.transaction((c) =>
        c
          .repository('stockBalances')
          .createOne({ values: { ...balance, id: randomUUID() } }),
      ),
    ).rejects.toThrow();
    await expect(
      connection.transaction((c) =>
        c.repository('stockDocuments').createOne({
          values: {
            ...head,
            id: randomUUID(),
            code: randomUUID(),
            subjectId: randomUUID(),
          },
        }),
      ),
    ).rejects.toThrow();
    await connection.repository('stockPostings').createOne({
      values: {
        id: postingId,
        documentId,
        subjectId,
        reversesPostingId: null,
        fingerprint: 'a'.repeat(64),
        actorId: 'migration-fixture',
        reason: 'Immutable facts',
        createdAt: now,
      },
    });
    await connection.repository('stockMovements').createOne({
      values: {
        id: movementId,
        postingId,
        documentId,
        documentLineId: lineId,
        subjectId,
        warehouseId,
        skuId,
        baseUnitId: unitId,
        balanceId,
        ordinal: 1,
        quality: 'qualified',
        deltaQuantity: '9007199254740993.125',
        dimensionKey: `${subjectId}:warehouse:${warehouseId}:${skuId}:qualified`,
        createdAt: now,
      },
    });
    for (const table of ['stockMovements', 'stockPostings']) {
      const id = table === 'stockMovements' ? movementId : postingId;
      await expect(
        connection.transaction((c) =>
          c
            .repository(table)
            .updateOne({ filter: { id }, values: { createdAt: new Date() } }),
        ),
      ).rejects.toThrow();
      await expect(
        connection.transaction((c) =>
          c.repository(table).deleteOne({ filter: { id } }),
        ),
      ).rejects.toThrow();
    }
    expect(await connection.repository('stockMovements').count()).toBe(1);
  },
  down: async ({ connection, expectCollection }) => {
    for (const table of [
      'stockDocuments',
      'stockDocumentLines',
      'warehouseStockGates',
      'stockBalances',
      'stockPostings',
      'stockMovements',
      'stockReservations',
      'stockIssueFulfillments',
      'stockActionRequests',
    ])
      await expectCollection(table).not.toExist();
    expect(
      await connection
        .repository('warehouses')
        .findOne({ filter: { id: warehouseId } }),
    ).toMatchObject({ subjectId, name: master.name, status: 'active' });
    expect(
      await connection
        .repository('materialSkus')
        .findOne({ filter: { id: skuId } }),
    ).toMatchObject({ materialNameId: nameId, baseUnitId: unitId });
  },
});

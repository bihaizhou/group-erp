// @vitest-environment node
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';

const tables = [
  'purchaseRequests',
  'purchaseRequestLines',
  'supplyChainRequestVersions',
  'supplyChainReviewTasks',
  'supplyChainParameterHeads',
  'supplyChainParameterVersions',
  'supplyChainParameterSelections',
  'supplyChainParameterRequests',
  'supplyChainParameterSnapshots',
  'supplyChainParameterUsages',
];
const now = new Date();
const subjectId = randomUUID();
const partnerId = randomUUID();
const settingId = randomUUID();
const legacySnapshots = new Map<string, unknown>();
const legacy = [
  [
    'orgSubjects',
    {
      id: subjectId,
      code: 'LEGACY-PURCHASE-COMPANY',
      name: 'Existing purchase company',
      type: 'group',
      status: 'active',
      sortOrder: 0,
      revision: 3,
      createdAt: now,
      updatedAt: now,
    },
  ],
  [
    'businessPartners',
    {
      id: partnerId,
      code: 'LEGACY-PURCHASE-SUPPLIER',
      name: 'Existing supplier',
      registrationCode: null,
      status: 'active',
      revision: 4,
      lifecycleVersion: 2,
      statusChangedAt: now,
      createdBy: 'migration-test',
      createdAt: now,
      updatedAt: now,
    },
  ],
  [
    'partnerSubjectSettings',
    {
      id: settingId,
      partnerId,
      subjectId,
      partnerRole: 'supplier',
      notes: 'Existing company exclusion',
      status: 'inactive',
      revision: 5,
      lifecycleVersion: 3,
      statusChangedAt: now,
      createdBy: 'migration-test',
      createdAt: now,
      updatedAt: now,
    },
  ],
] as const;
describeMigration('202610180001_purchase_requests', {
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
    for (const [table, values] of legacy) {
      await connection.repository(table).createOne({ values });
      legacySnapshots.set(
        table,
        await connection
          .repository(table)
          .findOne({ filter: { id: values.id } }),
      );
    }
  },
  up: async ({ connection, expectCollection }) => {
    for (const name of tables)
      expect((await expectCollection(name).toExist()).primaryKey).toEqual([
        'id',
      ]);
    for (const field of [
      'requestId',
      'subjectId',
      'requestedQuantity',
      'inputRevision',
      'selectionInput',
    ])
      await expectCollection('purchaseRequestLines').toHaveField(field, {
        nullable: false,
      });
    await expectCollection('purchaseRequests').toHaveField(
      'requesterEmployeeId',
      { nullable: true },
    );
    await expectCollection('supplyChainParameterSelections').toHaveField(
      'versionId',
      { nullable: false },
    );
    for (const [table, values] of legacy)
      expect(
        await connection
          .repository(table)
          .findOne({ filter: { id: values.id } }),
      ).toEqual(legacySnapshots.get(table));
    await expectCollection('purchaseRequestLines').toHaveForeignKey(
      ['requestId', 'subjectId'],
      'purchaseRequests',
      { referencedFields: ['id', 'subjectId'] },
    );
    await expectCollection('purchaseRequestLines').toHaveIndex(
      ['requestId', 'lineNo'],
      { unique: true },
    );
    await expectCollection('supplyChainRequestVersions').toHaveIndex(
      ['kind', 'requestId', 'contentVersion'],
      { unique: true },
    );
  },
  down: async ({ connection, expectCollection }) => {
    for (const name of tables) await expectCollection(name).not.toExist();
    for (const name of [
      'businessPartners',
      'partnerSubjectSettings',
      'personnelEmployees',
      'materialSkus',
      'supplyChainAudit',
    ])
      await expectCollection(name).toExist();
    for (const [table, values] of legacy)
      expect(
        await connection
          .repository(table)
          .findOne({ filter: { id: values.id } }),
      ).toEqual(legacySnapshots.get(table));
  },
});

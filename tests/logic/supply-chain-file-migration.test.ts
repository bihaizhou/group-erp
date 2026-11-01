// @vitest-environment node
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';
const subjectId = randomUUID(),
  requestId = randomUUID(),
  lineId = randomUUID(),
  versionId = randomUUID(),
  fileId = randomUUID(),
  now = new Date();
const head = {
  id: requestId,
  code: 'LEGACY-SOURCE-DEMAND',
  subjectId,
  requesterEmployeeId: null,
  requesterAccountId: null,
  requestingUnitId: null,
  usage: 'Maintenance',
  neededOn: null,
  suggestedSupplierId: null,
  supplierSnapshot: null,
  notes: '',
  status: 'draft',
  statusChangedAt: now,
  lifecycleVersion: 0,
  revision: 1,
  contentVersion: 1,
  governanceEpoch: 1,
  reviewRound: 0,
  identifiedCount: 0,
  identificationStatus: 'unidentified',
  lineCount: 1,
  submittedVersionId: null,
  approvedVersionId: null,
  parameterContract: 1,
  supersedesId: null,
  createdBy: 'migration-fixture',
  updatedBy: 'migration-fixture',
  submittedBy: null,
  submittedAt: null,
  approvedAt: null,
  createdAt: now,
  updatedAt: now,
};
const line = {
  id: lineId,
  requestId,
  subjectId,
  lineNo: 1,
  status: 'active',
  revision: 1,
  inputRevision: 1,
  governanceAttempt: 0,
  originalName: 'Legacy original',
  originalSpecification: 'Legacy specification',
  requestedQuantity: '2',
  requestedUnitText: 'box',
  identificationStatus: 'unidentified',
  activeSourceLinkId: null,
  usage: 'Maintenance',
  notes: '',
  selectionInput: { legacy: true },
  ...Object.fromEntries(
    [
      'requestedUnitId',
      'materialNameId',
      'skuId',
      'skuRevision',
      'managementModeSnapshot',
      'unitId',
      'unitRuleId',
      'unitRuleRevision',
      'numeratorSnapshot',
      'denominatorSnapshot',
      'baseUnitId',
      'baseQuantity',
      'materialSnapshot',
      'confirmedBy',
      'confirmedAt',
    ].map((field) => [field, null]),
  ),
};

const file = {
  id: fileId,
  disk: 'local',
  key: 'isolated-only',
  filename: 'legacy.png',
  ext: 'png',
  mimeType: 'image/png',
  size: 1,
  ownerId: 'fixture',
  kind: 'purchaseRequest',
  documentId: requestId,
  subjectId,
  purchaseRequestId: requestId,
  issueRequestId: null,
  createdAt: now,
  updatedAt: now,
};
const link = {
  id: randomUUID(),
  kind: 'purchaseRequest',
  documentId: requestId,
  subjectId,
  purchaseRequestId: requestId,
  issueRequestId: null,
  purchaseLineId: lineId,
  issueLineId: null,
  fileId,
  versionId: null,
  versionKey: 'current',
  shareWithGovernance: true,
  createdAt: now,
};
describeMigration('202610180004_supply_chain_files', {
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
    await connection
      .repository('orgSubjects')
      .createOne({
        values: {
          id: subjectId,
          code: randomUUID(),
          name: 'Existing attachment company',
          type: 'group',
          status: 'active',
          sortOrder: 0,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      });
    await connection.repository('purchaseRequests').createOne({ values: head });
    await connection
      .repository('purchaseRequestLines')
      .createOne({ values: line });
    await connection
      .repository('supplyChainRequestVersions')
      .createOne({
        values: {
          id: versionId,
          kind: 'purchaseRequest',
          requestId,
          issueRequestId: null,
          subjectId,
          contentVersion: 1,
          payload: { head, lines: [line] },
          createdAt: now,
        },
      });
  },
  up: async ({ connection, expectCollection }) => {
    await expectCollection('supplyChainFiles').toExist();
    await expectCollection('supplyChainFileLinks').toHaveForeignKey(
      ['fileId', 'documentId', 'subjectId'],
      'supplyChainFiles',
      { referencedFields: ['id', 'documentId', 'subjectId'] },
    );
    await connection.repository('supplyChainFiles').createOne({ values: file });
    for (const patch of [
      { kind: 'materialIssueRequest' },
      { documentId: randomUUID() },
      { purchaseRequestId: null },
    ])
      await expect(
        connection.transaction((c) =>
          c
            .repository('supplyChainFiles')
            .createOne({ values: { ...file, id: randomUUID(), ...patch } }),
        ),
      ).rejects.toThrow();
    await connection
      .repository('supplyChainFileLinks')
      .createOne({ values: link });
    for (const patch of [
      { purchaseLineId: randomUUID() },
      { subjectId: randomUUID() },
      { versionId: randomUUID(), versionKey: 'unrelated' },
      { purchaseLineId: null, shareWithGovernance: true },
    ])
      await expect(
        connection.transaction((c) =>
          c
            .repository('supplyChainFileLinks')
            .createOne({ values: { ...link, id: randomUUID(), ...patch } }),
        ),
      ).rejects.toThrow();
    await connection
      .repository('supplyChainFileLinks')
      .createOne({
        values: { ...link, id: randomUUID(), versionId, versionKey: versionId },
      });
    await expect(
      connection.transaction((c) =>
        c.repository('supplyChainFiles').deleteOne({ filter: { id: fileId } }),
      ),
    ).rejects.toThrow();
  },
  down: async ({ connection, expectCollection }) => {
    await expectCollection('supplyChainFiles').not.toExist();
    await expectCollection('supplyChainFileLinks').not.toExist();
    expect(
      await connection
        .repository('purchaseRequestLines')
        .findOne({ filter: { id: lineId } }),
    ).toMatchObject({ originalName: line.originalName, inputRevision: 1 });
    expect(
      await connection
        .repository('supplyChainRequestVersions')
        .findOne({ filter: { id: versionId } }),
    ).toMatchObject({ contentVersion: 1 });
  },
});

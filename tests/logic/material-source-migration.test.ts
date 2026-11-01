// @vitest-environment node
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';
const subjectId = randomUUID(),
  requestId = randomUUID(),
  lineId = randomUUID(),
  taskId = randomUUID(),
  sourceId = randomUUID(),
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
const source = {
  id: sourceId,
  requestId: taskId,
  sourceKind: 'purchaseRequestLine',
  purchaseRequestLineId: lineId,
  materialIssueRequestLineId: null,
  sourceDocumentId: requestId,
  subjectId,
  sourceInputRevision: 1,
  sourceEpoch: 1,
  sourceAttempt: 1,
  revision: 1,
  status: 'pending',
  proposedSkuId: null,
  offeredAt: null,
  inputSnapshot: { legacy: true },
  resolutionSnapshot: null,
  requestedBy: 'migration-fixture',
  sourceHandlerId: 'migration-fixture',
  reason: 'Explicit source migration verification',
  invalidatedReason: '',
  createdAt: now,
  updatedAt: now,
};
describeMigration('202610180003_material_request_sources', {
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
        name: 'Legacy source company',
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
    await connection.repository('materialRequests').createOne({
      values: {
        id: taskId,
        code: randomUUID(),
        name: 'Existing standalone task',
        subjectId,
        specification: 'Existing specification',
        proposedUnit: 'box',
        usage: 'Maintenance',
        resolvedSkuId: null,
        notes: '',
        status: 'pending',
        revision: 2,
        lifecycleVersion: 1,
        statusChangedAt: now,
        createdBy: 'migration-fixture',
        createdAt: now,
        updatedAt: now,
      },
    });
  },
  up: async ({ connection, expectCollection }) => {
    await expectCollection('materialRequestSources').toExist();
    await expectCollection('materialRequestSources').toHaveForeignKey(
      ['purchaseRequestLineId', 'sourceDocumentId', 'subjectId'],
      'purchaseRequestLines',
      { referencedFields: ['id', 'requestId', 'subjectId'] },
    );
    await expectCollection('materialRequestSources').toHaveForeignKey(
      ['requestId', 'subjectId'],
      'materialRequests',
      { referencedFields: ['id', 'subjectId'] },
    );
    await expectCollection('materialRequestSources').toHaveIndex(
      ['requestId'],
      { unique: true },
    );
    expect(
      await connection
        .repository('purchaseRequestLines')
        .findOne({ filter: { id: lineId } }),
    ).toMatchObject({ originalName: line.originalName, inputRevision: 1 });
    for (const patch of [
      { sourceKind: 'materialIssueRequestLine' },
      { sourceInputRevision: 0 },
      { sourceDocumentId: randomUUID() },
      { subjectId: randomUUID() },
    ])
      await expect(
        connection.transaction((c) =>
          c
            .repository('materialRequestSources')
            .createOne({ values: { ...source, ...patch } }),
        ),
      ).rejects.toThrow();
    await connection
      .repository('materialRequestSources')
      .createOne({ values: source });
    await connection
      .repository('purchaseRequestLines')
      .updateOne({
        filter: { id: lineId },
        values: {
          activeSourceLinkId: sourceId,
          identificationStatus: 'governing',
        },
      });
    await expect(
      connection.transaction((c) =>
        c
          .repository('materialRequestSources')
          .createOne({ values: { ...source, id: randomUUID() } }),
      ),
    ).rejects.toThrow();
  },
  down: async ({ connection, expectCollection }) => {
    await expectCollection('materialRequestSources').not.toExist();
    expect(
      await connection
        .repository('materialRequests')
        .findOne({ filter: { id: taskId } }),
    ).toMatchObject({ name: 'Existing standalone task', revision: 2 });
    expect(
      await connection
        .repository('purchaseRequestLines')
        .findOne({ filter: { id: lineId } }),
    ).toMatchObject({
      originalSpecification: line.originalSpecification,
      inputRevision: 1,
      activeSourceLinkId: null,
      identificationStatus: 'unidentified',
    });
  },
});

// @vitest-environment node
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';

const subjectId = randomUUID(),
  requestId = randomUUID(),
  versionId = randomUUID(),
  taskId = randomUUID(),
  now = new Date();
const legacyHead = {
  id: requestId,
  code: 'LEGACY-ISSUE-UPGRADE-PURCHASE',
  subjectId,
  requesterEmployeeId: null,
  requesterAccountId: null,
  requestingUnitId: null,
  usage: 'Existing purchase demand',
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
  lineCount: 0,
  submittedVersionId: null,
  approvedVersionId: null,
  parameterContract: 1,
  supersedesId: null,
  createdBy: 'isolated-migration',
  updatedBy: 'isolated-migration',
  submittedBy: null,
  submittedAt: null,
  approvedAt: null,
  createdAt: now,
  updatedAt: now,
};
describeMigration('202610180002_material_issue_requests', {
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
        name: 'Existing company',
        type: 'group',
        status: 'active',
        sortOrder: 0,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
    await connection
      .repository('purchaseRequests')
      .createOne({ values: legacyHead });
    await connection.repository('supplyChainRequestVersions').createOne({
      values: {
        id: versionId,
        kind: 'purchaseRequest',
        requestId,
        subjectId,
        contentVersion: 1,
        payload: { existing: true },
        createdAt: now,
      },
    });
    await connection.repository('supplyChainReviewTasks').createOne({
      values: {
        id: taskId,
        kind: 'purchaseRequest',
        requestId,
        subjectId,
        round: 1,
        versionId,
        candidates: ['legacy-reviewer'],
        excludedActors: [],
        status: 'closed',
        decidedBy: null,
        reason: 'Existing history',
        decidedAt: now,
        createdAt: now,
      },
    });
  },
  up: async ({ connection, expectCollection }) => {
    for (const table of [
      'materialIssuePurposes',
      'materialIssueRequests',
      'materialIssueRequestLines',
    ])
      await expectCollection(table).toExist();
    await expectCollection('materialIssueRequests').toHaveForeignKey(
      ['purposeId', 'subjectId'],
      'materialIssuePurposes',
      { referencedFields: ['id', 'subjectId'] },
    );
    await expectCollection('supplyChainRequestVersions').toHaveForeignKey(
      ['issueRequestId', 'subjectId'],
      'materialIssueRequests',
      { referencedFields: ['id', 'subjectId'] },
    );
    await expectCollection('supplyChainRequestVersions').toHaveIndex(
      ['kind', 'issueRequestId', 'contentVersion'],
      { unique: true },
    );
    expect(
      await connection
        .repository('purchaseRequests')
        .findOne({ filter: { id: requestId } }),
    ).toMatchObject({ code: legacyHead.code, revision: 1, status: 'draft' });
    expect(
      await connection
        .repository('supplyChainRequestVersions')
        .findOne({ filter: { id: versionId } }),
    ).toMatchObject({
      requestId,
      issueRequestId: null,
      payload: { existing: true },
    });
    expect(
      await connection
        .repository('supplyChainReviewTasks')
        .findOne({ filter: { id: taskId } }),
    ).toMatchObject({
      requestId,
      issueRequestId: null,
      reason: 'Existing history',
    });
    await expect(
      connection.transaction((c) =>
        c.repository('supplyChainRequestVersions').createOne({
          values: {
            id: randomUUID(),
            kind: 'materialIssueRequest',
            requestId,
            issueRequestId: null,
            subjectId,
            contentVersion: 99,
            payload: {},
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      connection.transaction((c) =>
        c.repository('supplyChainRequestVersions').createOne({
          values: {
            id: randomUUID(),
            kind: 'purchaseRequest',
            requestId: null,
            issueRequestId: null,
            subjectId,
            contentVersion: 99,
            payload: {},
            createdAt: now,
          },
        }),
      ),
    ).rejects.toThrow();
  },
  down: async ({ connection, expectCollection }) => {
    for (const table of [
      'materialIssueRequestLines',
      'materialIssueRequests',
      'materialIssuePurposes',
    ])
      await expectCollection(table).not.toExist();
    await expectCollection('supplyChainRequestVersions').toHaveField(
      'requestId',
      { nullable: false },
    );
    expect(
      await connection
        .repository('supplyChainRequestVersions')
        .findOne({ filter: { id: versionId } }),
    ).toMatchObject({ requestId, payload: { existing: true } });
    expect(
      await connection
        .repository('supplyChainReviewTasks')
        .findOne({ filter: { id: taskId } }),
    ).toMatchObject({ requestId, reason: 'Existing history' });
  },
});

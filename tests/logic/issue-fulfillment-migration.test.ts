// @vitest-environment node
import path from 'node:path';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';

describeMigration('202611010005_issue_fulfillment', {
  sources: [
    {
      packageName: 'group-erp',
      directory: path.resolve(
        import.meta.dirname,
        '../../database/main/migrations',
      ),
    },
  ],
  up: async ({ expectCollection, connection }) => {
    for (const field of [
      'fulfillmentStatus',
      'issuedAt',
      'issuedBy',
      'receivedAt',
      'receivedBy',
      'receiptNote',
    ] as const)
      await expectCollection('materialIssueRequests').toHaveField(field);
    await expectCollection('stockIssueFulfillments').toHaveField(
      'receivedQuantity',
    );
    await expect(
      connection.query
        .selectFrom('stockIssueFulfillments')
        .select('receivedQuantity')
        .limit(1)
        .execute(),
    ).resolves.toBeInstanceOf(Array);
  },
  down: async ({ connection }) => {
    for (const [table, field] of [
      ['materialIssueRequests', 'fulfillmentStatus'],
      ['stockIssueFulfillments', 'receivedQuantity'],
    ] as const)
      await expect(
        connection.query.selectFrom(table).select(field).limit(1).execute(),
      ).rejects.toThrow();
  },
});

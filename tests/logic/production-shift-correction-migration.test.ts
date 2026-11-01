// @vitest-environment node
import path from 'node:path';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';

const fields = [
  'voidedBy',
  'voidedAt',
  'voidReason',
  'reopenedBy',
  'reopenedAt',
  'correctionHistory',
] as const;

describeMigration('202611010001_production_report_corrections', {
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
    await expectCollection('prdShiftReports').toExist();
    for (const field of fields) {
      await expectCollection('prdShiftReports').toHaveField(field, {
        nullable: true,
      });
    }
    // The correction history is JSON, so a reopened report can keep every
    // voided revision without a second history table.
    await expect(
      connection.query
        .selectFrom('prdShiftReports')
        .select('correctionHistory')
        .limit(1)
        .execute(),
    ).resolves.toBeInstanceOf(Array);
  },
  down: async ({ connection }) => {
    for (const field of fields) {
      await expect(
        connection.query
          .selectFrom('prdShiftReports')
          .select(field)
          .limit(1)
          .execute(),
      ).rejects.toThrow();
    }
  },
});

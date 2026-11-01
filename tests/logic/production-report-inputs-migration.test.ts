// @vitest-environment node
import path from 'node:path';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';

describeMigration('202611010003_production_report_inputs', {
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
    await expectCollection('prdShiftReportInputs').toExist();
    for (const field of [
      'reportId',
      'skuId',
      'quantity',
      'sourceType',
      'stockDocumentLineId',
      'note',
      'version',
    ] as const)
      await expectCollection('prdShiftReportInputs').toHaveField(field);
    await expect(
      connection.query
        .selectFrom('prdShiftReportInputs')
        .select(['id', 'reportId', 'sourceType'])
        .limit(1)
        .execute(),
    ).resolves.toBeInstanceOf(Array);
  },
  down: async ({ connection }) => {
    await expect(
      connection.query
        .selectFrom('prdShiftReportInputs')
        .select('id')
        .limit(1)
        .execute(),
    ).rejects.toThrow();
  },
});

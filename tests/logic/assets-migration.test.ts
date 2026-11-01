// @vitest-environment node
import path from 'node:path';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';

describeMigration('202611010006_assets', {
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
      'subjectId',
      'code',
      'name',
      'status',
      'custodianEmployeeId',
      'originalCost',
      'version',
    ] as const)
      await expectCollection('assets').toHaveField(field);
    for (const field of [
      'assetId',
      'action',
      'toEmployeeId',
      'actorId',
    ] as const)
      await expectCollection('assetEvents').toHaveField(field);
    await expect(
      connection.query.selectFrom('assets').select('code').limit(1).execute(),
    ).resolves.toBeInstanceOf(Array);
  },
  down: async ({ connection }) => {
    for (const table of ['assetEvents', 'assets'] as const)
      await expect(
        connection.query.selectFrom(table).selectAll().limit(1).execute(),
      ).rejects.toThrow();
  },
});

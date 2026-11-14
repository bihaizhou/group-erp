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

describeMigration('202611130009_asset_event_statuses', {
  sources: [
    {
      packageName: 'group-erp',
      directory: path.resolve(
        import.meta.dirname,
        '../../database/main/migrations',
      ),
    },
    // Earlier app migrations (e.g. 202611010007_review_settings_page) read
    // authorizationPermissionSets, created by the authorization plugin whose
    // migrations live outside this package.
    {
      packageName: '@nocobase/app-plugin-authorization',
      directory: path.resolve(
        import.meta.dirname,
        '../../node_modules/@nocobase/app-plugin-authorization/dist/database/migrations',
      ),
    },
  ],
  up: async ({ expectCollection, connection }) => {
    for (const field of ['fromStatus', 'toStatus'] as const)
      await expectCollection('assetEvents').toHaveField(field);
    await expect(
      connection.query
        .selectFrom('assetEvents')
        .select(['fromStatus', 'toStatus'])
        .limit(1)
        .execute(),
    ).resolves.toBeInstanceOf(Array);
  },
  down: async ({ connection }) => {
    await expect(
      connection.query
        .selectFrom('assetEvents')
        .select('fromStatus')
        .limit(1)
        .execute(),
    ).rejects.toThrow();
  },
});

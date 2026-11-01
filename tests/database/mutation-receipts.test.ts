import { createRequire } from 'node:module';
import path from 'node:path';
import { describeMigration } from '@nocobase/app-testing/server';
import { expect } from 'vitest';

const require = createRequire(import.meta.url);
// Migrations this one depends on, from the package that owns the permission-set tables: a migration source only
// registers its own migrations, so the plugin's have to be named to run first, as they do in the application.
const authorizationMigrations = path.join(
  path.dirname(
    require.resolve('@nocobase/app-plugin-authorization/package.json'),
  ),
  'dist/database/migrations',
);

describeMigration('202611020002_create_mutation_receipts', {
  sources: [
    {
      packageName: '@nocobase/app-plugin-authorization',
      directory: authorizationMigrations,
    },
    {
      packageName: 'operation-receipts-test',
      directory: path.resolve(
        import.meta.dirname,
        '../../database/main/migrations',
      ),
    },
  ],
  up: async ({ connection, expectCollection }) => {
    const receipts = await expectCollection('mutationReceipts').toExist();
    expect(receipts.primaryKey).toEqual(['id']);
    await expectCollection('mutationReceipts').toHaveField('expiresAt', {
      nullable: false,
    });
    await connection.query
      .insertInto('mutationReceipts')
      .values({
        id: 'sample',
        digest: 'digest',
        result: '{}',
        expiresAt: new Date(),
      })
      .execute();
    await expect(
      connection.query
        .insertInto('mutationReceipts')
        .values({
          id: 'sample',
          digest: 'other',
          result: '{}',
          expiresAt: new Date(),
        })
        .execute(),
    ).rejects.toThrow();
  },
  down: async ({ expectCollection }) => {
    await expectCollection('mutationReceipts').not.toExist();
  },
});

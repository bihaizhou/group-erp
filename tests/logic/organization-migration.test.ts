// @vitest-environment node
import path from 'node:path';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';

describeMigration('202610160001_organization', {
  sources: [
    {
      packageName: 'group-erp',
      directory: path.resolve(
        import.meta.dirname,
        '../../database/main/migrations',
      ),
    },
  ],
  up: async ({ expectCollection }) => {
    for (const name of [
      'orgSubjects',
      'orgUnits',
      'orgPositions',
      'orgSectors',
      'orgRegions',
      'orgRelations',
      'orgAudit',
      'orgMutationLock',
    ]) {
      const collection = await expectCollection(name).toExist();
      expect(collection.primaryKey).toEqual(['id']);
    }
    await expectCollection('orgUnits').toHaveField('subjectId', {
      nullable: false,
    });
    await expectCollection('orgPositions').toHaveField('unitId', {
      nullable: false,
    });
    await expectCollection('orgAudit').toHaveField('beforeValue', {
      nullable: true,
    });
  },
  down: async ({ expectCollection }) => {
    for (const name of [
      'orgSubjects',
      'orgUnits',
      'orgPositions',
      'orgSectors',
      'orgRegions',
      'orgRelations',
      'orgAudit',
      'orgMutationLock',
    ])
      await expectCollection(name).not.toExist();
  },
});

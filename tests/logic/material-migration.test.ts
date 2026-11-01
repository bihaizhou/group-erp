// @vitest-environment node
import path from 'node:path';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';

describeMigration('202610170001_materials', {
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
      'materialCategories',
      'materialNames',
      'materialAttributeTemplates',
      'measureUnits',
      'materialSkus',
      'materialUnitRules',
      'materialReferences',
      'materialTags',
      'materialTagLinks',
      'materialRequests',
      'materialRequestLinks',
      'materialSubjectSettings',
      'warehouses',
      'materialAudit',
      'materialMutationLock',
    ]) {
      const collection = await expectCollection(name).toExist();
      expect(collection.primaryKey).toEqual(['id']);
    }
    await expectCollection('materialSkus').toHaveField('identityKey', {
      nullable: false,
    });
    await expectCollection('materialSkus').toHaveField('baseUnitId', {
      nullable: false,
    });
    await expectCollection('materialRequests').toHaveField('subjectId', {
      nullable: false,
    });
  },
  down: async ({ expectCollection }) => {
    for (const name of [
      'materialCategories',
      'materialNames',
      'materialAttributeTemplates',
      'measureUnits',
      'materialSkus',
      'materialUnitRules',
      'materialReferences',
      'materialTags',
      'materialTagLinks',
      'materialRequests',
      'materialRequestLinks',
      'materialSubjectSettings',
      'warehouses',
      'materialAudit',
      'materialMutationLock',
    ])
      await expectCollection(name).not.toExist();
    await expectCollection('personnelEmployees').toExist();
    await expectCollection('orgSubjects').toExist();
  },
});

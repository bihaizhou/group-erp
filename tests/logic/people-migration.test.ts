// @vitest-environment node
import path from 'node:path';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';

const collections = [
  'personnelEmployees',
  'personnelEmployments',
  'personnelAssignments',
  'personnelChanges',
  'hrDimensions',
  'hrModels',
  'hrProfiles',
  'hrEvaluations',
  'hrDevelopmentPlans',
  'hrWorkforcePlans',
  'peopleAudit',
  'personnelPrivate',
  'peopleFiles',
  'lifecycleTransitions',
  'lifecycleEffectRuns',
];
describeMigration('202610160002_people', {
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
    for (const name of collections) {
      const c = await expectCollection(name).toExist();
      expect(c.primaryKey).toEqual(['id']);
    }
    await expectCollection('hrEvaluations').toHaveField('snapshot', {
      nullable: true,
    });
    await expectCollection('hrProfiles').toHaveField('grade', {
      nullable: true,
    });
    await expectCollection('lifecycleTransitions').toHaveField('requestKey', {
      nullable: false,
    });
    await expectCollection('personnelPrivate').toHaveField('phone', {
      nullable: true,
    });
  },
  down: async ({ expectCollection }) => {
    for (const name of collections) await expectCollection(name).not.toExist();
  },
});

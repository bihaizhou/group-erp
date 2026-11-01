// @vitest-environment node
import path from 'node:path';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';

describeMigration('202610170003_procurement_suppliers', {
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
      'businessPartners',
      'partnerSubjectSettings',
      'supplyChainAudit',
      'supplyChainActionRequests',
      'supplyChainMutationLock',
    ]) {
      const c = await expectCollection(name).toExist();
      expect(c.primaryKey).toEqual(['id']);
    }
    await expectCollection('businessPartners').toHaveField('registrationCode', {
      nullable: true,
    });
    await expectCollection('partnerSubjectSettings').toHaveField('subjectId', {
      nullable: false,
    });
    await expectCollection('partnerSubjectSettings').toHaveField('partnerId', {
      nullable: false,
    });
    await expectCollection('supplyChainActionRequests').toHaveField(
      'fingerprint',
      { nullable: false },
    );
  },
  down: async ({ expectCollection }) => {
    for (const name of [
      'businessPartners',
      'partnerSubjectSettings',
      'supplyChainAudit',
      'supplyChainActionRequests',
      'supplyChainMutationLock',
    ])
      await expectCollection(name).not.toExist();
    await expectCollection('materialSkus').toExist();
    await expectCollection('orgSubjects').toExist();
    await expectCollection('personnelEmployees').toExist();
  },
});

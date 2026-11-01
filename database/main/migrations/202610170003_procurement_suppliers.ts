import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202610170003_procurement_suppliers',
  async up({ builder }) {
    await builder.createCollection('businessPartners', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('registrationCode', { length: 128, nullable: true });
      c.unique('registrationCode');
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.index('updatedAt');
      c.index('status');
    });
    await builder.createCollection('partnerSubjectSettings', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('partnerId', { length: 36, nullable: false });
      c.foreignKey('partnerId', {
        references: { collection: 'businessPartners', fields: ['id'] },
        name: 'partnerSubjectSettings_partner_fk',
      });
      c.string('subjectId', { length: 36, nullable: false });
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'partnerSubjectSettings_subject_fk',
      });
      c.string('partnerRole', { length: 32, nullable: false });
      c.unique(['partnerId', 'subjectId', 'partnerRole']);
      c.index(['subjectId', 'status', 'updatedAt']);
      c.text('notes', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
    });
    await builder.createCollection('supplyChainAudit', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('kind', { length: 64, nullable: false });
      c.string('recordId', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: true });
      c.string('actorId', { length: 200, nullable: false });
      c.string('operation', { length: 64, nullable: false });
      c.text('reason', { nullable: false });
      c.json('beforeValue', { nullable: true });
      c.json('afterValue', { nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.index(['kind', 'recordId', 'createdAt']);
      c.index(['subjectId', 'createdAt']);
    });
    await builder.createCollection('supplyChainActionRequests', (c) => {
      c.string('id', { length: 64, nullable: false });
      c.primary('id');
      c.string('actorId', { length: 200, nullable: false });
      c.string('requestKey', { length: 36, nullable: false });
      c.unique(['actorId', 'requestKey']);
      c.string('fingerprint', { length: 64, nullable: false });
      c.string('resultId', { length: 36, nullable: false });
      c.json('response', { nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
    });
    await builder.createCollection('supplyChainMutationLock', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('nonce', { length: 36, nullable: false });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('supplyChainMutationLock');
    await builder.dropCollection('supplyChainActionRequests');
    await builder.dropCollection('supplyChainAudit');
    await builder.dropCollection('partnerSubjectSettings');
    await builder.dropCollection('businessPartners');
  },
});

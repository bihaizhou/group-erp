import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202610260001_operations_issues',
  async up({ builder }) {
    await builder.createCollection('opsIssues', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: true });
      c.string('sourceType', { length: 32, nullable: false });
      c.string('sourceId', { length: 36, nullable: true });
      c.string('title', { length: 200, nullable: false });
      c.text('description', { nullable: false });
      c.string('severity', { length: 16, nullable: false });
      c.string('ownerName', { length: 200, nullable: false });
      c.date('dueAt', { nullable: false });
      c.string('status', { length: 16, nullable: false, defaultValue: 'open' });
      c.text('resolution', { nullable: false, defaultValue: '' });
      c.datetimeTz('closedAt', { nullable: true });
      c.string('closedBy', { length: 200, nullable: true });
      c.integer('version', { nullable: false, defaultValue: 1 });
      for (const field of ['createdBy', 'updatedBy'])
        c.string(field, { length: 200, nullable: false });
      for (const field of ['createdAt', 'updatedAt'])
        c.datetime(field, { nullable: false });
      c.index(['subjectId', 'status']);
      c.index(['subjectId', 'dueAt']);
      c.index('unitId');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'opsIssues_subjectId_fk',
      });
      c.foreignKey('unitId', {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'opsIssues_unitId_fk',
      });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('opsIssues');
  },
});

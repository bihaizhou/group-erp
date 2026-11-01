import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202610270001_operations_targets',
  async up({ builder }) {
    await builder.createCollection('opsKpiTargets', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('subjectId', { length: 36, nullable: false });
      c.string('period', { length: 7, nullable: false });
      c.string('metric', { length: 32, nullable: false });
      c.string('targetValue', { length: 25, nullable: false });
      c.integer('version', { nullable: false, defaultValue: 1 });
      for (const field of ['createdBy', 'updatedBy'])
        c.string(field, { length: 200, nullable: false });
      for (const field of ['createdAt', 'updatedAt'])
        c.datetime(field, { nullable: false });
      c.unique(['subjectId', 'period', 'metric']);
      c.index(['subjectId', 'period']);
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'opsKpiTargets_subjectId_fk',
      });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('opsKpiTargets');
  },
});

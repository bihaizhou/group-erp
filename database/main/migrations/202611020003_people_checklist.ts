import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611020003_people_checklist',
  transaction: true,
  async up({ builder }) {
    await builder.createCollection('peopleChangeChecklist', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('changeId', { length: 36, nullable: false });
      c.string('key', { length: 64, nullable: false });
      c.string('title', { length: 200, nullable: false });
      c.string('owner', { length: 64, nullable: false });
      c.integer('sort', { nullable: false, defaultValue: 0 });
      c.boolean('done', { nullable: false, defaultValue: false });
      c.string('doneBy', { length: 200, nullable: true });
      c.datetimeTz('doneAt', { nullable: true });
      c.text('note', { nullable: false, defaultValue: '' });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.unique(['changeId', 'key']);
      c.index(['changeId', 'sort']);
      c.foreignKey('changeId', {
        references: { collection: 'personnelChanges', fields: ['id'] },
        name: 'people_checklist_change_fk',
      });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('peopleChangeChecklist');
  },
});

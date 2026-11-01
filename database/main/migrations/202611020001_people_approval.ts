import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611020001_people_approval',
  transaction: true,
  async up({ builder }) {
    await builder.alterCollection('personnelChanges', (c) => {
      c.integer('reviewRound', { nullable: false, defaultValue: 0 });
    });
    await builder.createCollection('peopleApprovalTasks', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('changeId', { length: 36, nullable: false });
      c.integer('round', { nullable: false });
      c.integer('stageIndex', { nullable: false });
      c.string('stageKey', { length: 64, nullable: false });
      c.string('title', { length: 100, nullable: false });
      c.string('mode', { length: 8, nullable: false });
      c.string('status', { length: 16, nullable: false });
      c.json('candidates', { nullable: false });
      c.json('decisions', { nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('decidedAt', { nullable: true });
      c.unique(['changeId', 'round', 'stageIndex']);
      c.index(['changeId', 'status']);
      c.index(['status', 'createdAt']);
      c.foreignKey('changeId', {
        references: { collection: 'personnelChanges', fields: ['id'] },
        name: 'people_approval_change_fk',
      });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('peopleApprovalTasks');
    await builder.alterCollection('personnelChanges', (c) => {
      c.dropField('reviewRound');
    });
  },
});

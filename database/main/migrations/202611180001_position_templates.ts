import { defineMigration } from '@nocobase/db';

/**
 * Position templates.
 *
 * A template is a named bundle of permission sets. Positions opt into one
 * template (orgPositions.templateId); the account of everyone holding the
 * position then inherits the template's sets in addition to the explicit
 * position mappings. This keeps the permission sets as the single
 * authorization unit while letting HR describe "job families" once.
 */
export default defineMigration({
  name: '202611180001_position_templates',
  async up({ builder }) {
    await builder.createCollection('orgPositionTemplates', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('status', { length: 16, nullable: false, defaultValue: 'active' });
      c.integer('sortOrder', { nullable: false, defaultValue: 0 });
      c.json('permissionSetKeys', { nullable: false });
      c.text('notes', { nullable: true });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.index('status');
    });
    await builder.alterCollection('orgPositions', (c) => {
      // A plain reference column: alterCollection has no foreign-key
      // precedent and adding one rebuilds the table (SQLite then refuses
      // while orgUnits.leaderPositionId / personnelAssignments still point
      // at orgPositions). Existence is validated in the position route.
      c.string('templateId', { length: 36, nullable: true });
      c.index('templateId');
    });
  },
  async down({ builder }) {
    await builder.alterCollection('orgPositions', (c) => {
      c.dropField('templateId');
    });
    await builder.dropCollection('orgPositionTemplates');
  },
});

import { defineMigration } from '@nocobase/db';

/**
 * Page-level field visibility is a presentation preference, not a data
 * permission. A role may show a field on a "new" form while hiding it on the
 * list even though both pages read the same collection. Keep it in its own
 * table so it can never be mistaken for (or weaken) the resource-level field
 * policies that redact API responses.
 */
export default defineMigration({
  name: '202611160005_page_field_visibility',
  async up({ builder }) {
    await builder.createCollection('appPageFieldVisibilities', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('permissionSetKey', { length: 120, nullable: false });
      c.string('pageKey', { length: 200, nullable: false });
      c.string('resource', { length: 160, nullable: false });
      c.string('field', { length: 160, nullable: false });
      c.boolean('visible', { nullable: false, defaultValue: true });
      c.integer('version', { nullable: false, defaultValue: 1 });
      c.string('createdBy', { length: 200, nullable: false });
      c.string('updatedBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.primary('id');
      c.unique(['permissionSetKey', 'pageKey', 'resource', 'field']);
      c.index(['permissionSetKey', 'pageKey']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('appPageFieldVisibilities');
  },
});

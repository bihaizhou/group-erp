import { defineMigration } from '@nocobase/db';

/**
 * Field-level access per permission set. A page can be visible to an account
 * while some of its fields stay hidden, read-only or writable for that
 * account. Rows are keyed by the permission set, so one account's effective
 * field access is the union of its sets (most permissive wins).
 */
export default defineMigration({
  name: '202611110001_app_field_policies',
  async up({ builder }) {
    await builder.createCollection('appFieldPolicies', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('permissionSetKey', { length: 100, nullable: false });
      c.string('settingsId', { length: 100, nullable: true });
      c.string('resource', { length: 100, nullable: false });
      c.string('field', { length: 100, nullable: false });
      c.string('access', {
        length: 16,
        nullable: false,
        defaultValue: 'readonly',
      });
      c.integer('version', { nullable: false, defaultValue: 1 });
      c.string('createdBy', { length: 200, nullable: false });
      c.string('updatedBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.primary('id');
      c.unique(['permissionSetKey', 'resource', 'field']);
      c.index(['settingsId', 'resource']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('appFieldPolicies');
  },
});

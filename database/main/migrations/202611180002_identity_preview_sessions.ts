import { defineMigration } from '@nocobase/db';

/**
 * A root account can preview the business identity of an existing employee
 * without inventing a fake employee card. One row per preview: starting a new
 * preview ends the previous one, and expiry bounds how long a forgotten
 * preview can keep changing what business pages show.
 */
export default defineMigration({
  name: '202611180002_identity_preview_sessions',
  async up({ builder }) {
    await builder.createCollection('appIdentityPreviewSessions', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('userId', { length: 200, nullable: false });
      c.string('employeeId', { length: 36, nullable: false });
      c.string('employeeName', { length: 200, nullable: false });
      c.string('status', {
        length: 16,
        nullable: false,
        defaultValue: 'active',
      });
      c.datetimeTz('startedAt', { nullable: false });
      c.datetimeTz('expiresAt', { nullable: false });
      c.datetimeTz('endedAt', { nullable: true });
      c.primary('id');
      c.index(['userId', 'status']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('appIdentityPreviewSessions');
  },
});

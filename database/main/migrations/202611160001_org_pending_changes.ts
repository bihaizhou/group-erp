import { defineMigration } from '@nocobase/db';

/**
 * Scheduled organization changes. A mutation aimed at a future business date is
 * queued here instead of being written to the org record immediately, then the
 * periodic sweep applies it once `effectiveFrom` is reached. `version` is the
 * org record revision the change was scheduled from; `payload` holds only the
 * fields the change touches. `operation` records the intended final audit
 * action (update / enable / disable) so the pending list can describe it before
 * it is applied.
 */
export default defineMigration({
  name: '202611160001_org_pending_changes',
  async up({ builder }) {
    await builder.createCollection('orgPendingChanges', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('kind', { length: 16, nullable: false });
      c.string('recordId', { length: 36, nullable: false });
      c.string('operation', { length: 16, nullable: false });
      c.json('payload', { nullable: false });
      c.string('effectiveFrom', { length: 10, nullable: false });
      c.string('status', {
        length: 16,
        nullable: false,
        defaultValue: 'pending',
      });
      c.text('reason', { nullable: false });
      c.string('actorId', { length: 36, nullable: false });
      c.string('actorName', { length: 200, nullable: false });
      c.string('errorReason', { length: 500, nullable: true });
      c.date('appliedAt', { nullable: true });
      c.integer('version', { nullable: false, defaultValue: 0 });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.index(['status', 'effectiveFrom']);
      c.index('recordId');
    });
  },
  async down({ builder }) {
    // Dropping the table discards scheduled and applied change history; there is
    // no way to restore it after rollback.
    await builder.dropCollection('orgPendingChanges');
  },
});

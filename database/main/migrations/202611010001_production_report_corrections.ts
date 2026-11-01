import { defineMigration } from '@nocobase/db';

/**
 * Shift-report corrections are in-place: a confirmed report can be voided
 * (only while no active inbound document exists) and reopened as a draft.
 * The unique key (unit, date, shift) stays stable, while the snapshot keeps
 * the voided revision available for audit.
 */
export default defineMigration({
  name: '202611010001_production_report_corrections',
  async up({ builder }) {
    await builder.alterCollection('prdShiftReports', (c) => {
      c.string('voidedBy', { length: 200, nullable: true });
      c.datetimeTz('voidedAt', { nullable: true });
      c.text('voidReason', { nullable: true });
      c.string('reopenedBy', { length: 200, nullable: true });
      c.datetimeTz('reopenedAt', { nullable: true });
      c.json('correctionHistory', { nullable: true });
    });
  },
  async down({ builder }) {
    await builder.alterCollection('prdShiftReports', (c) => {
      c.dropField('voidedBy');
      c.dropField('voidedAt');
      c.dropField('voidReason');
      c.dropField('reopenedBy');
      c.dropField('reopenedAt');
      c.dropField('correctionHistory');
    });
  },
});

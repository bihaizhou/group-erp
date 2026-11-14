import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611130002_material_resolve_units',
  transaction: true,
  async up({ builder }) {
    await builder.alterCollection('materialRequests', (c) => {
      // Reference columns without FK by design (alterCollection 内无加 FK
      // 先例，与 202611130008/202611130010 一致): resolved at selection
      // time via the material service, which validates both ids before
      // persisting.
      c.string('resolvedUnitId', { length: 36, nullable: true });
      c.string('resolvedUnitRuleId', { length: 36, nullable: true });
      c.index('resolvedUnitId');
      c.index('resolvedUnitRuleId');
    });
  },
  async down({ builder }) {
    await builder.alterCollection('materialRequests', (c) => {
      c.dropField('resolvedUnitRuleId');
      c.dropField('resolvedUnitId');
    });
  },
});

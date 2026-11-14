import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611130009_asset_event_statuses',
  transaction: true,
  async up({ builder }) {
    await builder.alterCollection('assetEvents', (c) => {
      c.string('fromStatus', { length: 16, nullable: true });
      c.string('toStatus', { length: 16, nullable: true });
    });
  },
  async down({ builder }) {
    await builder.alterCollection('assetEvents', (c) => {
      for (const field of ['fromStatus', 'toStatus']) c.dropField(field);
    });
  },
});

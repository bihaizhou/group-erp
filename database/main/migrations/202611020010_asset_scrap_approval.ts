import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611020010_asset_scrap_approval',
  transaction: true,
  async up({ builder }) {
    await builder.alterCollection('assets', (c) => {
      c.boolean('scrapPending', { nullable: false, defaultValue: false });
      c.text('scrapReason', { nullable: true });
      c.string('scrapDecision', { length: 16, nullable: true });
      c.string('scrapRequestedBy', { length: 64, nullable: true });
      c.date('scrapRequestedAt', { nullable: true });
      c.string('scrapDecidedBy', { length: 64, nullable: true });
      c.date('scrapDecidedAt', { nullable: true });
    });
  },
  async down({ builder }) {
    await builder.alterCollection('assets', (c) => {
      for (const field of [
        'scrapPending',
        'scrapReason',
        'scrapDecision',
        'scrapRequestedBy',
        'scrapRequestedAt',
        'scrapDecidedBy',
        'scrapDecidedAt',
      ])
        c.dropField(field);
    });
  },
});

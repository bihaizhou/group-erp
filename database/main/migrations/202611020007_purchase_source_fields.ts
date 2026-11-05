import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611020007_purchase_source_fields',
  transaction: true,
  async up({ builder }) {
    await builder.alterCollection('purchaseRequests', (c) => {
      c.date('businessDate', { nullable: true });
      c.string('sourceChannel', {
        length: 16,
        nullable: false,
        defaultValue: 'manual',
      });
    });
  },
  async down({ builder }) {
    await builder.alterCollection('purchaseRequests', (c) => {
      c.dropField('sourceChannel');
      c.dropField('businessDate');
    });
  },
});

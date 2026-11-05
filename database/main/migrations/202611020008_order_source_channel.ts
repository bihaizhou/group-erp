import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611020008_order_source_channel',
  transaction: true,
  async up({ builder }) {
    for (const table of ['purchaseOrders', 'salesOrders'])
      await builder.alterCollection(table, (c) => {
        c.string('sourceChannel', {
          length: 16,
          nullable: false,
          defaultValue: 'manual',
        });
      });
  },
  async down({ builder }) {
    for (const table of ['purchaseOrders', 'salesOrders'])
      await builder.alterCollection(table, (c) => {
        c.dropField('sourceChannel');
      });
  },
});

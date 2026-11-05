import { defineMigration } from '@nocobase/db';

/**
 * Orders keep the money they were saved with: the line amount is quantity
 * times unit price, rounded to the currency's 2 decimals, and the header keeps
 * the sum. Both are written by the service when the document is saved, so a
 * later price-list change cannot rewrite an approved order.
 */
export default defineMigration({
  name: '202611020006_order_amounts',
  async up({ builder }) {
    for (const collection of ['purchaseOrderLines', 'salesOrderLines'])
      await builder.alterCollection(collection, (c) => {
        c.string('amount', { length: 25, nullable: true });
      });
    for (const collection of ['purchaseOrders', 'salesOrders'])
      await builder.alterCollection(collection, (c) => {
        c.string('totalAmount', { length: 25, nullable: true });
      });
  },
  async down({ builder }) {
    for (const collection of ['purchaseOrders', 'salesOrders'])
      await builder.alterCollection(collection, (c) => {
        c.dropField('totalAmount');
      });
    for (const collection of ['purchaseOrderLines', 'salesOrderLines'])
      await builder.alterCollection(collection, (c) => {
        c.dropField('amount');
      });
  },
});

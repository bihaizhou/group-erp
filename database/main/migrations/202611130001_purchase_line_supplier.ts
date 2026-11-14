import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611130001_purchase_line_supplier',
  transaction: true,
  async up({ builder }) {
    await builder.alterCollection('purchaseRequestLines', (c) => {
      // Reference column without FK by design (alterCollection 内无加 FK
      // 先例，与 202611130008/202611130010 一致): resolved at selection
      // time via the material service, and the canonical name/unit data is
      // frozen in supplierSnapshot.
      c.string('supplierId', { length: 36, nullable: true });
      c.json('supplierSnapshot', { nullable: true });
      c.index('supplierId');
    });
  },
  async down({ builder }) {
    await builder.alterCollection('purchaseRequestLines', (c) => {
      c.dropField('supplierSnapshot');
      c.dropField('supplierId');
    });
  },
});

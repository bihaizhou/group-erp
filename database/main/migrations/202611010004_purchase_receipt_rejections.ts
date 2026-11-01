import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611010004_purchase_receipt_rejections',
  async up({ builder }) {
    await builder.alterCollection('stockDocumentLines', (c) => {
      c.string('baseRejectedQuantity', {
        length: 25,
        defaultValue: '0',
        nullable: false,
      });
    });
  },
  async down({ builder }) {
    await builder.alterCollection('stockDocumentLines', (c) => {
      c.dropField('baseRejectedQuantity');
    });
  },
});

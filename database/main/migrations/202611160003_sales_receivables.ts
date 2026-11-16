import { defineMigration } from '@nocobase/db';

/**
 * Sales ledger: customer material price lists, shipment receivables and the
 * payments registered against them.
 *
 * Money is stored as a decimal string (length 25 for amounts, 30 for unit
 * prices) like every other commercial field in this application, so the
 * service layer can keep exact fixed-point arithmetic. The tables keep the
 * subject scope on every row: a receivable is always read and written through
 * its company.
 */
const audit = (c: {
  integer: (name: string, options: object) => void;
  string: (name: string, options: object) => void;
  datetimeTz: (name: string, options: object) => void;
}) => {
  c.integer('version', { nullable: false, defaultValue: 1 });
  c.string('createdBy', { length: 200, nullable: false });
  c.string('updatedBy', { length: 200, nullable: false });
  c.datetimeTz('createdAt', { nullable: false });
  c.datetimeTz('updatedAt', { nullable: false });
};

export default defineMigration({
  name: '202611160003_sales_receivables',
  async up({ builder }) {
    await builder.createCollection('salesPriceLists', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('customerId', { length: 36, nullable: false });
      c.string('skuId', { length: 36, nullable: false });
      c.string('unitPrice', { length: 30, nullable: true });
      c.string('currency', { length: 3, nullable: false, defaultValue: 'CNY' });
      c.date('effectiveFrom', { nullable: false });
      c.date('effectiveTo', { nullable: true });
      c.string('status', { length: 16, nullable: false, defaultValue: 'active' });
      c.text('note', { nullable: true });
      audit(c);
      c.primary('id');
      c.unique(['subjectId', 'customerId', 'skuId', 'effectiveFrom']);
      c.index(['subjectId', 'status']);
      c.foreignKey(['subjectId'], {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'salesPriceLists_subject_fk',
      });
      c.foreignKey(['customerId'], {
        references: { collection: 'businessPartners', fields: ['id'] },
        name: 'salesPriceLists_customer_fk',
      });
      c.foreignKey(['skuId'], {
        references: { collection: 'materialSkus', fields: ['id'] },
        name: 'salesPriceLists_sku_fk',
      });
    });
    await builder.createCollection('salesReceivables', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('customerId', { length: 36, nullable: false });
      c.string('orderId', { length: 36, nullable: false });
      c.string('orderLineId', { length: 36, nullable: false });
      c.string('documentId', { length: 36, nullable: false });
      c.string('amount', { length: 25, nullable: false });
      c.string('currency', { length: 3, nullable: false, defaultValue: 'CNY' });
      c.string('status', { length: 16, nullable: false, defaultValue: 'open' });
      c.date('dueDate', { nullable: true });
      c.text('note', { nullable: true });
      audit(c);
      c.primary('id');
      // One receivable per shipped order line: posting the same document again
      // must never duplicate the ledger row.
      c.unique(['documentId', 'orderLineId']);
      c.index(['subjectId', 'status']);
      c.index(['documentId']);
      c.index(['orderId']);
      c.foreignKey(['subjectId'], {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'salesReceivables_subject_fk',
      });
      c.foreignKey(['customerId'], {
        references: { collection: 'businessPartners', fields: ['id'] },
        name: 'salesReceivables_customer_fk',
      });
      c.foreignKey(['orderId'], {
        references: { collection: 'salesOrders', fields: ['id'] },
        name: 'salesReceivables_order_fk',
      });
      c.foreignKey(['orderLineId'], {
        references: { collection: 'salesOrderLines', fields: ['id'] },
        name: 'salesReceivables_order_line_fk',
      });
      c.foreignKey(['documentId'], {
        references: { collection: 'stockDocuments', fields: ['id'] },
        name: 'salesReceivables_document_fk',
      });
    });
    await builder.createCollection('salesPayments', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('receivableId', { length: 36, nullable: false });
      c.string('amount', { length: 25, nullable: false });
      c.date('paidAt', { nullable: false });
      c.string('method', { length: 32, nullable: false });
      c.string('reference', { length: 200, nullable: true });
      c.string('note', { length: 500, nullable: true });
      audit(c);
      c.primary('id');
      c.index(['receivableId']);
      c.foreignKey(['receivableId'], {
        references: { collection: 'salesReceivables', fields: ['id'] },
        name: 'salesPayments_receivable_fk',
      });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('salesPayments');
    await builder.dropCollection('salesReceivables');
    await builder.dropCollection('salesPriceLists');
  },
});

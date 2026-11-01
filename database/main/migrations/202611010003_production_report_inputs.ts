import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611010003_production_report_inputs',
  async up({ builder }) {
    await builder.createCollection('prdShiftReportInputs', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      for (const field of ['subjectId', 'reportId', 'skuId', 'unitId'])
        c.string(field, { length: 36, nullable: false });
      c.string('quantity', { length: 25, nullable: false });
      c.string('unit', { length: 20, nullable: false });
      c.string('sourceType', { length: 16, nullable: false });
      for (const field of [
        'issueRequestId',
        'issueRequestLineId',
        'stockDocumentId',
        'stockDocumentLineId',
      ])
        c.string(field, { length: 36, nullable: true });
      c.text('note', { nullable: false, defaultValue: '' });
      c.integer('version', { nullable: false, defaultValue: 1 });
      for (const field of ['createdBy', 'updatedBy'])
        c.string(field, { length: 200, nullable: false });
      for (const field of ['createdAt', 'updatedAt'])
        c.datetimeTz(field, { nullable: false });
      c.index(['reportId']);
      c.index(['subjectId', 'skuId']);
      c.unique(['id', 'reportId', 'subjectId']);
      c.unique(['reportId', 'stockDocumentLineId']);
      c.foreignKey('reportId', {
        references: { collection: 'prdShiftReports', fields: ['id'] },
        name: 'prd_report_input_report_fk',
      });
      c.foreignKey('skuId', {
        references: { collection: 'materialSkus', fields: ['id'] },
        name: 'prd_report_input_sku_fk',
      });
      c.foreignKey('unitId', {
        references: { collection: 'measureUnits', fields: ['id'] },
        name: 'prd_report_input_unit_fk',
      });
      c.foreignKey('issueRequestId', {
        references: { collection: 'materialIssueRequests', fields: ['id'] },
        name: 'prd_report_input_issue_request_fk',
      });
      c.foreignKey('stockDocumentId', {
        references: { collection: 'stockDocuments', fields: ['id'] },
        name: 'prd_report_input_stock_document_fk',
      });
      c.foreignKey('stockDocumentLineId', {
        references: { collection: 'stockDocumentLines', fields: ['id'] },
        name: 'prd_report_input_stock_line_fk',
      });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('prdShiftReportInputs');
  },
});

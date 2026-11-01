import { defineMigration } from '@nocobase/db';

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
  name: '202610240003_production_shift_reports',
  async up({ builder }) {
    await builder.createCollection('prdShiftReports', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: false });
      c.date('reportDate', { nullable: false });
      c.string('shift', { length: 16, nullable: false });
      c.string('status', {
        length: 16,
        nullable: false,
        defaultValue: 'draft',
      });
      for (const field of [
        'processedQuantity',
        'metalQuantity',
        'sandQuantity',
        'tailingsQuantity',
      ])
        c.string(field, {
          length: 25,
          nullable: false,
          defaultValue: '0',
        });
      c.integer('runtimeMinutes', { nullable: false, defaultValue: 0 });
      c.integer('downtimeMinutes', { nullable: false, defaultValue: 0 });
      c.text('notes', { nullable: true });
      c.string('confirmedBy', { length: 200, nullable: true });
      c.datetimeTz('confirmedAt', { nullable: true });
      audit(c);
      c.primary('id');
      c.unique(['unitId', 'reportDate', 'shift']);
      c.index(['subjectId', 'reportDate']);
      c.index(['unitId', 'reportDate']);
      c.index('status');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'prdShiftReports_subjectId_fk',
      });
      c.foreignKey('unitId', {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'prdShiftReports_unitId_fk',
      });
    });

    await builder.createCollection('prdShiftReportOutputs', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('reportId', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: false });
      c.string('outputType', { length: 16, nullable: false });
      c.string('skuId', { length: 36, nullable: false });
      c.string('warehouseId', { length: 36, nullable: true });
      c.string('quantity', { length: 25, nullable: false });
      c.string('stockDocumentId', { length: 36, nullable: true });
      audit(c);
      c.primary('id');
      c.unique(['reportId', 'outputType']);
      c.index('subjectId');
      c.index('skuId');
      c.index('warehouseId');
      c.index('stockDocumentId');
      c.foreignKey('reportId', {
        references: { collection: 'prdShiftReports', fields: ['id'] },
        name: 'prdShiftReportOutputs_reportId_fk',
      });
      c.foreignKey('skuId', {
        references: { collection: 'materialSkus', fields: ['id'] },
        name: 'prdShiftReportOutputs_skuId_fk',
      });
      c.foreignKey('warehouseId', {
        references: { collection: 'warehouses', fields: ['id'] },
        name: 'prdShiftReportOutputs_warehouseId_fk',
      });
      c.foreignKey('stockDocumentId', {
        references: { collection: 'stockDocuments', fields: ['id'] },
        name: 'prdShiftReportOutputs_stockDocumentId_fk',
      });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('prdShiftReportOutputs');
    await builder.dropCollection('prdShiftReports');
  },
});

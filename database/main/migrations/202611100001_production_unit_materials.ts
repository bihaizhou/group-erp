import { defineMigration } from '@nocobase/db';

const audit = (c: {
  string: (name: string, options: object) => void;
  integer: (name: string, options: object) => void;
  datetimeTz: (name: string, options: object) => void;
}) => {
  c.integer('version', { nullable: false, defaultValue: 1 });
  c.string('createdBy', { length: 200, nullable: false });
  c.string('updatedBy', { length: 200, nullable: false });
  c.datetimeTz('createdAt', { nullable: false });
  c.datetimeTz('updatedAt', { nullable: false });
};

/**
 * Production units describe what they handle as a material list: the feedstock
 * they process, the products and byproducts they turn it into, and the
 * auxiliary materials they consume. Shift reports record one row per material,
 * together with the physical stock count and the book quantity at that moment.
 */
export default defineMigration({
  name: '202611100001_production_unit_materials',
  async up({ builder, repository }) {
    await builder.createCollection('prdUnitMaterials', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: false });
      c.string('skuId', { length: 36, nullable: false });
      c.string('role', { length: 16, nullable: false });
      c.string('defaultWarehouseId', { length: 36, nullable: true });
      c.integer('sortOrder', { nullable: false, defaultValue: 0 });
      c.string('status', {
        length: 16,
        nullable: false,
        defaultValue: 'active',
      });
      c.text('notes', { nullable: true });
      audit(c);
      c.primary('id');
      c.unique(['unitId', 'skuId']);
      c.index(['unitId', 'sortOrder']);
      c.index(['subjectId']);
      c.foreignKey(['subjectId'], {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'prdUnitMaterials_subjectId_fk',
      });
      c.foreignKey(['unitId'], {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'prdUnitMaterials_unitId_fk',
      });
    });
    await builder.createCollection('prdShiftReportMaterials', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('reportId', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: false });
      c.string('skuId', { length: 36, nullable: false });
      c.string('role', { length: 16, nullable: false });
      c.string('quantity', { length: 25, nullable: false, defaultValue: '0' });
      c.string('stockQuantity', { length: 25, nullable: true });
      c.string('bookQuantity', { length: 25, nullable: true });
      c.string('stockDocumentId', { length: 36, nullable: true });
      c.text('note', { nullable: false, defaultValue: '' });
      audit(c);
      c.primary('id');
      c.unique(['reportId', 'skuId']);
      c.index(['reportId']);
      c.index(['subjectId', 'skuId']);
      c.index(['unitId', 'skuId']);
      c.foreignKey(['reportId'], {
        references: { collection: 'prdShiftReports', fields: ['id'] },
        name: 'prdShiftReportMaterials_reportId_fk',
      });
      c.foreignKey(['subjectId'], {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'prdShiftReportMaterials_subjectId_fk',
      });
    });
    const mappings = await repository('prdOutputMappings').findMany({
      limit: 10000,
    });
    for (const mapping of mappings) {
      const unitId = String(mapping.unitId ?? '');
      const skuId = String(mapping.skuId ?? '');
      if (!unitId || !skuId) continue;
      if (
        await repository('prdUnitMaterials').exists({
          filter: { unitId, skuId },
        })
      )
        continue;
      const now = new Date().toISOString();
      await repository('prdUnitMaterials').createOne({
        values: {
          id: crypto.randomUUID(),
          subjectId: String(mapping.subjectId ?? ''),
          unitId,
          skuId,
          role: 'product',
          defaultWarehouseId: mapping.defaultWarehouseId ?? null,
          sortOrder: String(mapping.outputType ?? '') === 'sand' ? 20 : 10,
          status: 'active',
          notes: mapping.notes ?? null,
          version: 1,
          createdBy: String(mapping.createdBy ?? 'system'),
          updatedBy: String(mapping.updatedBy ?? 'system'),
          createdAt: now,
          updatedAt: now,
        },
      });
    }
  },
  async down({ builder }) {
    await builder.dropCollection('prdShiftReportMaterials');
    await builder.dropCollection('prdUnitMaterials');
  },
});

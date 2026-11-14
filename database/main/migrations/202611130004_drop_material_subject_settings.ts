import { defineMigration } from '@nocobase/db';

// 公司物料设置 (materialSubjectSettings) is removed. The per-company × per-SKU
// purchase/sales admission whitelist was deprecated; all active materials are
// now available to every company. The table is dropped entirely.
// 决策依据：docs/物料准入与采购销售开放范围决策-2026-11-13.md（2026-11-13 已决策：方案 A，
// 全量开放 + 治理护栏；领用保留 stock-only；销售价格表建成后改为"有当期价格"）。
export default defineMigration({
  name: '202611130004_drop_material_subject_settings',
  transaction: true,
  async up({ builder }) {
    await builder.dropCollection('materialSubjectSettings');
  },
  async down({ builder }) {
    // Schema restore only: rows that existed before the drop are lost.
    // Roll back to the pre-migration database backup to recover data.
    await builder.createCollection('materialSubjectSettings', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.string('name', { length: 200, nullable: false });
      c.text('notes', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.index('status');
      c.index('updatedAt');
      c.unique('code');
      c.string('subjectId', { length: 36, nullable: false });
      c.index('subjectId');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'materialSubjectSettings_subjectId_fk',
      });
      c.string('skuId', { length: 36, nullable: false });
      c.index('skuId');
      c.foreignKey('skuId', {
        references: { collection: 'materialSkus', fields: ['id'] },
        name: 'materialSubjectSettings_skuId_fk',
      });
      c.boolean('canPurchase', { nullable: false, defaultValue: true });
      c.boolean('canSell', { nullable: false, defaultValue: true });
      c.unique(['subjectId', 'skuId']);
    });
  },
});

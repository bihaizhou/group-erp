import { defineMigration } from '@nocobase/db';

/**
 * Units need an explicit output type per material line: a unit can produce
 * both metal and sand, and both lines share the `product` role. Without an
 * explicit type the confirm step falls back to role-based inference, which
 * collides with the (unit_id, output_type) uniqueness and blocks
 * confirmation for any unit with two product SKUs.
 *
 * This migration adds `outputType` to prdUnitMaterials and backfills it from
 * prdOutputMappings (the table that previously held the mapping but had no
 * write path). It also repairs rows that were copied from sand mappings into
 * the `product` role by 202611100001, which inflated metal totals.
 */
export default defineMigration({
  name: '202611130007_production_unit_material_output_types',
  transaction: true,
  async up({ builder, repository }) {
    await builder.alterCollection('prdUnitMaterials', (c) => {
      c.string('outputType', { length: 16, nullable: true });
    });
    const mappings = await repository('prdOutputMappings').findMany({
      // Deterministic order: the backfill below is limited, so an unordered
      // scan could pick a different page on every run.
      sort: (s) => [
        s.field('unitId').asc(),
        s.field('outputType').asc(),
        s.field('id').asc(),
      ],
      limit: 10000,
    });
    const typeByUnitSku = new Map<string, string>(
      mappings.map((mapping) => [
        `${String(mapping.unitId ?? '')}|${String(mapping.skuId ?? '')}`,
        String(mapping.outputType ?? ''),
      ]),
    );
    const rows = await repository('prdUnitMaterials').findMany({
      sort: (s) => [
        s.field('unitId').asc(),
        s.field('skuId').asc(),
        s.field('id').asc(),
      ],
      limit: 100000,
    });
    const now = new Date().toISOString();
    for (const row of rows) {
      const role = String(row.role ?? '');
      const key = `${String(row.unitId ?? '')}|${String(row.skuId ?? '')}`;
      const mapped = typeByUnitSku.get(key) || '';
      const outputType =
        mapped || (role === 'product' ? 'metal' : role === 'byproduct' ? 'sand' : null);
      const values: {
        outputType: string | null;
        updatedAt: string;
        role?: string;
      } = { outputType, updatedAt: now };
      // Repair the 202611100001 copy bug: sand mappings were copied with the
      // product role, which made writeReportMaterials sum them into metal.
      if (mapped === 'sand' && role === 'product') values.role = 'byproduct';
      if (outputType !== null || values.role !== undefined)
        await repository('prdUnitMaterials').updateOne({
          filter: { id: String(row.id ?? '') },
          values,
        });
    }
  },
  async down({ builder, repository }) {
    // Reverse the 202611100001 repair done in up(): sand-output lines that
    // were switched from product back to byproduct are restored to product,
    // so the schema and the data fix roll back together.
    const rows = await repository('prdUnitMaterials').findMany({
      filter: { outputType: 'sand', role: 'byproduct' },
      sort: (s) => [
        s.field('unitId').asc(),
        s.field('skuId').asc(),
        s.field('id').asc(),
      ],
      limit: 100000,
    });
    for (const row of rows) {
      await repository('prdUnitMaterials').updateOne({
        filter: { id: String(row.id ?? '') },
        values: { role: 'product', updatedAt: new Date().toISOString() },
      });
    }
    await builder.alterCollection('prdUnitMaterials', (c) => {
      c.dropField('outputType');
    });
  },
});

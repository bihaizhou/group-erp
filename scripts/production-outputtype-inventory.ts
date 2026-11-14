/**
 * Read-only inventory of production unit materials whose output type is
 * ambiguous for confirmation.
 *
 * A unit material line's `outputType` was backfilled from prd_output_mappings
 * (see 202611130007_production_unit_material_output_types). Where a unit has
 * two `product` rows sharing one `outputType` and no mapping row for that
 * unit/type, confirmation cannot tell the outputs apart and the
 * (report_id, output_type) uniqueness blocks it.
 *
 * Run from the application root:
 *   /usr/local/node/bin/node --import tsx scripts/production-outputtype-inventory.ts
 * Output: /tmp/production-outputtype-inventory.txt
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

type Candidate = {
  unitId: string;
  unitName: string | null;
  outputType: string;
  rowCount: number;
};

type MaterialRow = {
  id: string;
  subjectId: string;
  skuId: string;
  skuCode: string | null;
  skuName: string | null;
  status: string;
  role: string;
  outputType: string;
  skuMappingCount: number;
};

const root = fileURLToPath(new URL('..', import.meta.url));
const databasePath =
  process.env.PRODUCTION_DB ?? `${root}storage/database.sqlite`;
const outputPath =
  process.env.PRODUCTION_OUTPUTTYPE_INVENTORY ??
  '/tmp/production-outputtype-inventory.txt';

const db = new DatabaseSync(databasePath, { readOnly: true });

const candidates = db
  .prepare(
    `SELECT um.unit_id AS unitId,
            (SELECT u.name FROM org_units u WHERE u.id = um.unit_id) AS unitName,
            um.output_type AS outputType,
            COUNT(*) AS rowCount
       FROM prd_unit_materials um
      WHERE um.role = 'product'
        AND um.output_type IS NOT NULL
      GROUP BY um.unit_id, um.output_type
     HAVING COUNT(*) >= 2
      ORDER BY um.unit_id, um.output_type`,
  )
  .all() as unknown as Candidate[];

const materialQuery = db.prepare(
  `SELECT um.id AS id,
          um.subject_id AS subjectId,
          um.sku_id AS skuId,
          (SELECT s.code FROM material_skus s WHERE s.id = um.sku_id) AS skuCode,
          (SELECT s.name FROM material_skus s WHERE s.id = um.sku_id) AS skuName,
          um.status AS status,
          um.role AS role,
          um.output_type AS outputType,
          (SELECT COUNT(*) FROM prd_output_mappings m
            WHERE m.unit_id = um.unit_id AND m.sku_id = um.sku_id) AS skuMappingCount
     FROM prd_unit_materials um
    WHERE um.unit_id = ? AND um.output_type = ? AND um.role = 'product'
    ORDER BY um.sku_id, um.id`,
);

const mappingCountQuery = db.prepare(
  `SELECT COUNT(*) AS count FROM prd_output_mappings
    WHERE unit_id = ? AND output_type = ?`,
);

const lines: string[] = [
  'Production output-type inventory (read-only)',
  `Database: ${databasePath}`,
  `Generated: ${new Date().toISOString()}`,
  '',
];

let ambiguousGroups = 0;
let ambiguousRows = 0;
let configuredGroups = 0;

for (const candidate of candidates) {
  const mapping = mappingCountQuery.get(
    candidate.unitId,
    candidate.outputType,
  ) as { count: number };
  if (mapping.count > 0) {
    configuredGroups += 1;
    continue;
  }
  ambiguousGroups += 1;
  const rows = materialQuery.all(
    candidate.unitId,
    candidate.outputType,
  ) as unknown as MaterialRow[];
  ambiguousRows += rows.length;
  lines.push(
    `unit ${candidate.unitId}${candidate.unitName ? ` (${candidate.unitName})` : ''} outputType=${candidate.outputType} productRows=${rows.length} mappingRows=0`,
  );
  for (const row of rows) {
    lines.push(
      `  row ${row.id} subject=${row.subjectId} sku=${row.skuId}` +
        `${row.skuCode ? ` code=${row.skuCode}` : ''}` +
        `${row.skuName ? ` name=${row.skuName}` : ''}` +
        ` status=${row.status} skuMappingRows=${row.skuMappingCount}`,
    );
  }
}

lines.push(
  '',
  `Summary: candidateGroups=${ambiguousGroups} candidateRows=${ambiguousRows} excludedGroupsWithMapping=${configuredGroups}`,
  ambiguousGroups === 0
    ? 'Conclusion: no ambiguous duplicate product output-type rows found.'
    : 'Conclusion: ambiguous duplicate product output-type rows found; review the units above before confirming their reports.',
);

const report = `${lines.join('\n')}\n`;
writeFileSync(outputPath, report);
process.stdout.write(report);
console.log(`Wrote ${outputPath}`);

import { stockMicros, stockQuantity } from './inventory-quantity.js';

export interface PurchaseMergeMaterial {
  skuId: string | null;
  code: string;
  name: string;
  specification: string;
  unitId: string | null;
  unitName: string;
}

export interface PurchaseMergeSource {
  requestId: string;
  requestCode: string;
  subjectId: string;
  companyName: string;
  lineId: string;
  lineNo: number;
  requestedQuantity: string;
  requestedUnit: string;
  baseQuantity: string | null;
  baseUnit: string | null;
  neededOn: string | null;
  usage: string;
}

export interface PurchaseMergeGroup {
  key: string;
  kind: 'known' | 'unknown';
  material: PurchaseMergeMaterial;
  quantity: string;
  sources: PurchaseMergeSource[];
}

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const normalized = (value: unknown) =>
  text(value).normalize('NFKC').trim().toLowerCase();
const snapshot = (row: Row) =>
  (row.materialSnapshot && typeof row.materialSnapshot === 'object'
    ? row.materialSnapshot
    : {}) as Record<string, unknown>;
const companyChoice = (
  companies: Map<string, { code: string; name: string }>,
  id: string,
) => companies.get(id) ?? { code: '', name: '' };

function sourceOf(
  line: Row,
  request: Row,
  companyName: string,
): PurchaseMergeSource {
  return {
    requestId: text(request.id),
    requestCode: text(request.code),
    subjectId: text(line.subjectId),
    companyName,
    lineId: text(line.id),
    lineNo: Number(line.lineNo ?? 0),
    requestedQuantity: text(line.requestedQuantity),
    requestedUnit: text(line.requestedUnitText),
    baseQuantity: text(line.baseQuantity) || null,
    baseUnit:
      text(snapshot(line).baseUnitName) ||
      text(snapshot(line).unitName) ||
      null,
    neededOn: text(request.neededOn) || null,
    usage: text(line.usage),
  };
}

/**
 * Group approved request lines into a group purchase list. The result is
 * derived from current source rows, so computing it again never accumulates
 * a previous run.
 */
export function buildPurchaseMerge(
  requests: Row[],
  lines: Row[],
  companies: Map<string, { code: string; name: string }>,
): PurchaseMergeGroup[] {
  const requestById = new Map(requests.map((row) => [text(row.id), row])),
    groups = new Map<string, PurchaseMergeGroup & { totalMicros: bigint }>();
  for (const line of lines) {
    if (text(line.status) !== 'active') continue;
    const request = requestById.get(text(line.requestId));
    if (!request || text(request.status) !== 'approved') continue;
    const identified = text(line.identificationStatus) === 'identified',
      skuId = text(line.skuId),
      baseQuantity = text(line.baseQuantity),
      baseUnitId = text(line.baseUnitId),
      unitId = text(line.unitId),
      requestedUnit = text(line.requestedUnitText),
      material = snapshot(line),
      name = identified
        ? text(material.name) || text(line.originalName)
        : text(line.originalName),
      specification = identified
        ? text(material.standardName)
        : text(line.originalSpecification),
      unitName = identified
        ? text(material.baseUnitName) ||
          text(material.unitName) ||
          requestedUnit
        : requestedUnit;
    if (!name || !unitName) continue;
    let key: string, quantity: string, materialUnitId: string | null;
    if (identified && skuId) {
      if (baseQuantity && baseUnitId) {
        key = `known:${skuId}:${baseUnitId}`;
        quantity = baseQuantity;
        materialUnitId = baseUnitId;
      } else if (unitId) {
        key = `known:${skuId}:unit:${unitId}`;
        quantity = text(line.requestedQuantity);
        materialUnitId = unitId;
      } else continue;
    } else {
      if (!specification || !requestedUnit) continue;
      key = `unknown:${normalized(name)}|${normalized(specification)}|${normalized(requestedUnit)}`;
      quantity = text(line.requestedQuantity);
      materialUnitId = null;
    }
    if (!quantity) continue;
    const amount = stockMicros(quantity),
      existing = groups.get(key),
      companyName = companyChoice(companies, text(line.subjectId)).name,
      source = sourceOf(line, request, companyName);
    if (existing) {
      existing.totalMicros += amount;
      existing.sources.push(source);
    } else {
      groups.set(key, {
        key,
        kind: identified ? 'known' : 'unknown',
        material: {
          skuId: identified && skuId ? skuId : null,
          code: text(material.code),
          name,
          specification,
          unitId: materialUnitId,
          unitName,
        },
        quantity: '0',
        totalMicros: amount,
        sources: [source],
      });
    }
  }
  return [...groups.values()]
    .map((group) => {
      return {
        key: group.key,
        kind: group.kind,
        material: group.material,
        quantity: stockQuantity(group.totalMicros),
        sources: group.sources.sort(
          (a, b) =>
            a.requestCode.localeCompare(b.requestCode) ||
            a.lineNo - b.lineNo ||
            a.lineId.localeCompare(b.lineId),
        ),
      };
    })
    .sort(
      (a, b) =>
        a.material.name.localeCompare(b.material.name) ||
        a.material.code.localeCompare(b.material.code) ||
        a.material.unitName.localeCompare(b.material.unitName) ||
        a.key.localeCompare(b.key),
    );
}

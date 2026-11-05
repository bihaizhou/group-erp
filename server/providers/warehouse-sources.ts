import type { DatabaseConnection, FilterBuilder } from '@nocobase/db';
import type { MaterialPolicies } from './material-service.js';
import {
  executionRepo as repo,
  executionCompany,
  executionText as text,
  executionJson as json,
} from './execution-access.js';
import {
  inventoryError as fail,
  stockMicros,
  stockQuantity,
} from './inventory-quantity.js';

const sourceKinds = {
  purchaseReceipt: [
    'purchaseOrders',
    'purchaseOrderLines',
    'orderId',
    'approved',
  ],
  salesShipment: ['salesOrders', 'salesOrderLines', 'orderId', 'approved'],
  issue: [
    'materialIssueRequests',
    'materialIssueRequestLines',
    'requestId',
    'approved',
  ],
  transferDispatch: [
    'stockTransfers',
    'stockTransferLines',
    'transferId',
    'approved',
  ],
  transferReceipt: [
    'stockTransfers',
    'stockTransferLines',
    'transferId',
    'approved',
  ],
  transferDiscrepancy: [
    'stockTransfers',
    'stockTransferLines',
    'transferId',
    'approved',
  ],
  purchaseReturn: [
    'stockDocuments',
    'stockDocumentLines',
    'documentId',
    'posted',
  ],
  salesReturn: ['stockDocuments', 'stockDocumentLines', 'documentId', 'posted'],
  issueReturn: ['stockDocuments', 'stockDocumentLines', 'documentId', 'posted'],
  reversal: ['stockDocuments', 'stockDocumentLines', 'documentId', 'posted'],
} as const;
export type WarehouseSourceKind = keyof typeof sourceKinds;
export const warehouseSourceKinds = Object.keys(
  sourceKinds,
) as WarehouseSourceKind[];
/** Minimal business facade: no prices, identity payloads, HR or arbitrary JSON. */
export async function warehouseSources(
  c: DatabaseConnection,
  q: {
    kind: WarehouseSourceKind;
    subjectId: string;
    warehouseId: string;
    q: string;
    page: number;
    pageSize: number;
    sourceId?: string;
  },
  p: MaterialPolicies,
) {
  await executionCompany(c, q.subjectId, p);
  if (
    !(await repo(c, 'warehouses', p).exists({
      filter: { id: q.warehouseId, subjectId: q.subjectId },
    }))
  )
    return fail('STOCK_WAREHOUSE_UNAVAILABLE');
  const [table, lineTable, parent, status] = sourceKinds[q.kind],
    original = {
      purchaseReturn: 'purchaseReceipt',
      salesReturn: 'salesShipment',
      issueReturn: 'issue',
    }[q.kind as 'purchaseReturn' | 'salesReturn' | 'issueReturn'],
    filter = (f: FilterBuilder) =>
      f.and([
        f.string('subjectId').eq(q.subjectId),
        f.string('status').eq(status),
        ...(q.sourceId ? [f.string('id').eq(q.sourceId)] : []),
        ...(table === 'materialIssueRequests'
          ? []
          : [
              f
                .string(
                  table === 'stockTransfers' && q.kind === 'transferReceipt'
                    ? 'destinationWarehouseId'
                    : 'warehouseId',
                )
                .eq(q.warehouseId),
            ]),
        ...(original ? [f.string('kind').eq(original)] : []),
        ...(q.kind === 'reversal' ? [f.string('kind').ne('reversal')] : []),
        ...(q.q
          ? [f.string('code').includes(q.q, { mode: 'insensitive' })]
          : []),
      ]),
    scoped = repo(c, table, p),
    heads = await scoped.findMany({
      filter,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
      sort: (s) => [s.field('code').asc()],
    }),
    data = [];
  for (const head of heads) {
    if (typeof head.id !== 'string' || typeof head.code !== 'string')
      return fail('STOCK_FORBIDDEN');
    let available = true;
    if (table === 'stockDocuments') {
      const posting = await c
        .repository('stockPostings')
        .findOne({ filter: { documentId: head.id, subjectId: q.subjectId } });
      if (
        !posting ||
        (await c
          .repository('stockPostings')
          .exists({ filter: { reversesPostingId: text(posting.id) } }))
      )
        available = false;
    }
    const lines = await repo(c, lineTable, p).findMany({
        filter: { [parent]: head.id, subjectId: q.subjectId, status: 'active' },
        limit: 101,
        // Issue requester policies expose the business columns but not the
        // internal line order; sorting on it would reject the whole source list.
        sort:
          lineTable === 'materialIssueRequestLines'
            ? (s) => [s.field('id').asc()]
            : (s) => [s.field('lineNo').asc()],
      }),
      projected = [];
    if (lines.length > 100) return fail('STOCK_LINES_INVALID');
    for (const line of lines) {
      if (
        [
          'id',
          'skuId',
          'baseUnitId',
          'baseQuantity',
          'unitId',
          'numeratorSnapshot',
          'denominatorSnapshot',
        ].some((key) => !(key in line))
      )
        return fail('STOCK_FORBIDDEN');
      let remaining = stockMicros(text(line.baseQuantity));
      if (table.endsWith('Orders'))
        remaining +=
          stockMicros(text(line.replacementQuantity)) -
          stockMicros(text(line.fulfilledQuantity)) -
          stockMicros(text(line.closedQuantity));
      if (table === 'materialIssueRequests') {
        const fulfillment = await c
          .repository('stockIssueFulfillments')
          .findOne({ filter: { id: text(line.id) } });
        remaining -= stockMicros(
          fulfillment ? text(fulfillment.issuedQuantity) : '0',
        );
      }
      if (table === 'stockTransfers')
        remaining =
          q.kind === 'transferDispatch'
            ? remaining - stockMicros(text(line.dispatchedQuantity))
            : stockMicros(text(line.dispatchedQuantity)) -
              stockMicros(text(line.receivedQuantity)) -
              stockMicros(text(line.discrepancyQuantity));
      if (table === 'stockDocuments')
        remaining -= stockMicros(text(line.returnedQuantity));
      projected.push(
        json({
          id: line.id,
          skuId: line.skuId,
          baseUnitId: line.baseUnitId,
          unitId: line.unitId,
          unitRuleId: line.unitRuleId ?? null,
          quantity: line.quantity ?? line.requestedQuantity,
          baseQuantity: line.baseQuantity,
          numeratorSnapshot: line.numeratorSnapshot,
          denominatorSnapshot: line.denominatorSnapshot,
          conversionMode: text(line.conversionModeSnapshot) || 'exact',
          variancePercent: text(line.variancePercentSnapshot) || null,
          materialSnapshot: line.materialSnapshot ?? {},
          quality: line.quality ?? 'qualified',
          remainingQuantity: stockQuantity(remaining > 0n ? remaining : 0n),
        }),
      );
    }
    const posting =
      table === 'stockDocuments'
        ? await c
            .repository('stockPostings')
            .findOne({ filter: { documentId: head.id } })
        : null;
    data.push(
      json({
        id: head.id,
        code: head.code,
        available,
        subjectId: head.subjectId,
        warehouseId: head.warehouseId ?? q.warehouseId,
        destinationWarehouseId: head.destinationWarehouseId ?? null,
        status: head.status,
        revision: head.revision,
        lifecycleVersion: head.lifecycleVersion,
        versionId: head.approvedVersionId ?? null,
        postingId: posting?.id ?? null,
        lines: projected,
      }),
    );
  }
  return {
    data,
    meta: {
      page: q.page,
      pageSize: q.pageSize,
      total: await scoped.count({ filter }),
    },
  };
}

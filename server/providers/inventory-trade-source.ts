import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';
import { executionText as text } from './execution-access.js';
import { inventoryError as fail } from './inventory-quantity.js';

export async function approvedTradeLine(
  c: DatabaseConnection,
  kind: 'purchaseOrders' | 'salesOrders' | 'stockTransfers',
  documentId: string,
  lineId: string,
  subjectId: string,
) {
  const head = await c
    .repository(kind)
    .findOne({ filter: { id: documentId, subjectId, status: 'approved' } });
  if (!head || !head.approvedVersionId) return fail('STOCK_SOURCE_UNAVAILABLE');
  const table =
      kind === 'stockTransfers'
        ? 'stockTransferLines'
        : kind === 'purchaseOrders'
          ? 'purchaseOrderLines'
          : 'salesOrderLines',
    parent = kind === 'stockTransfers' ? 'transferId' : 'orderId',
    line = await c.repository(table).findOne({
      filter: {
        id: lineId,
        [parent]: documentId,
        subjectId,
        status: 'active',
      },
    }),
    version = await c.repository('executionVersions').findOne({
      filter: {
        id: text(head.approvedVersionId),
        kind,
        documentId,
        subjectId,
        contentVersion: Number(head.contentVersion),
      },
    }),
    frozen = (
      version?.payload as { lines?: RepositoryRecord[] } | undefined
    )?.lines?.find((row) => row.id === lineId);
  if (
    !line ||
    !frozen ||
    [
      'skuId',
      'baseUnitId',
      'unitId',
      'unitRuleId',
      'quantity',
      'baseQuantity',
      'numeratorSnapshot',
      'denominatorSnapshot',
    ].some((field) => (line[field] ?? null) !== (frozen[field] ?? null))
  )
    return fail('STOCK_SOURCE_CHANGED');
  return { head, line, frozen };
}

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
  if (!line || !frozen) return fail('STOCK_SOURCE_CHANGED');
  // Approved versions frozen before reference conversions existed carry no
  // conversion snapshot; those lines were exact by definition.
  const current: RepositoryRecord = {
      ...line,
      conversionModeSnapshot: text(line.conversionModeSnapshot) || 'exact',
      variancePercentSnapshot: text(line.variancePercentSnapshot) || null,
    },
    approved: RepositoryRecord = {
      ...frozen,
      conversionModeSnapshot: text(frozen.conversionModeSnapshot) || 'exact',
      variancePercentSnapshot: text(frozen.variancePercentSnapshot) || null,
    };
  if (
    [
      'skuId',
      'baseUnitId',
      'unitId',
      'unitRuleId',
      'quantity',
      'baseQuantity',
      'numeratorSnapshot',
      'denominatorSnapshot',
      'conversionModeSnapshot',
      'variancePercentSnapshot',
    ].some(
      (field) => (current[field] ?? null) !== (approved[field] ?? null),
    )
  )
    return fail('STOCK_SOURCE_CHANGED');
  return { head, line, frozen };
}

import { z } from 'zod';
import { decimalText, positiveDecimal } from './material-model.js';
import { materialSelectionInput } from './supply-chain-model.js';
import { executionKinds, executionRules } from './execution-workflow.js';

const id = z.string().uuid(),
  quantity = decimalText.refine(positiveDecimal),
  note = z.string().trim().max(6000).default(''),
  reason = z.string().trim().min(1).max(3000),
  quality = z.enum(['qualified', 'inspection', 'frozen']);
export const executionParams = z.strictObject({ id });
export const executionMutation = z.strictObject({
  version: z.number().int().min(1),
  lifecycleVersion: z.number().int().min(0),
  reason,
  requestKey: id,
});
export const executionPage = z.strictObject({
  q: z.string().trim().max(200).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const executionQuery = executionPage
  .extend({
    subjectId: id,
    warehouseId: id.optional(),
    direction: z.enum(['inbound', 'outbound']).optional(),
    kind: z
      .enum([
        'purchaseReceipt',
        'salesShipment',
        'issue',
        'purchaseReturn',
        'salesReturn',
        'issueReturn',
        'productionReceipt',
        'productionIssue',
        'transferDispatch',
        'transferReceipt',
        'initial',
        'loss',
        'qualityTransfer',
        'transferDiscrepancy',
        'countAdjustment',
        'reversal',
      ])
      .optional(),
    status: z
      .enum(['draft', 'counting', 'pending', 'approved', 'posted', 'cancelled'])
      .optional(),
    purchaseOrderId: id.optional(),
    salesOrderId: id.optional(),
    transferId: id.optional(),
    issueRequestId: id.optional(),
    originalDocumentId: id.optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    orderBy: z
      .enum([
        'code',
        '-code',
        'updatedAt',
        '-updatedAt',
        'occurredOn',
        '-occurredOn',
        'deliveryOn',
        '-deliveryOn',
        'baselineAt',
        '-baselineAt',
      ])
      .default('-updatedAt'),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ['to'],
    message: 'Invalid date range.',
  });
export const executionMeta = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  businessDate: z.string().optional(),
});
export const executionProjection = z.record(z.string(), z.json());
const known = materialSelectionInput.refine((v) => v.kind === 'known', {
  message: 'A confirmed SKU is required.',
});
export const executionSourceChannels = [
  'manual',
  'import',
  'api',
  'device',
] as const;
export type ExecutionSourceChannel = (typeof executionSourceChannels)[number];

export const orderLineInput = z.strictObject({
  id,
  selection: known,
  notes: note,
  unitPrice: z
    .string()
    .regex(/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,8})?$/u)
    .nullable()
    .default(null),
  allocations: z
    .array(
      z.strictObject({
        requestId: id,
        requestLineId: id,
        requestVersionId: id,
        baseQuantity: quantity,
      }),
    )
    .max(100)
    .default([]),
});
export const orderContent = z
  .strictObject({
    subjectId: id,
    warehouseId: id,
    partnerId: id,
    occurredOn: z.iso.date(),
    sourceChannel: z.enum(executionSourceChannels).default('manual'),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/u),
    deliveryOn: z.iso.date().nullable().default(null),
    deliveryTerms: note,
    notes: note,
    reason: z.string().trim().max(3000).default(''),
    demandMode: z.enum(['request', 'temporary']).nullable().default(null),
    temporaryReason: z.string().trim().max(600).nullable().default(null),
    lines: z.array(orderLineInput).min(1).max(100),
  })
  .refine(
    (v) => new Set(v.lines.map((line) => line.id)).size === v.lines.length,
    { path: ['lines'], message: 'Duplicate line IDs.' },
  );
export const orderCreate = z.strictObject({
  content: orderContent,
  requestKey: id,
});
export const orderUpdate = executionMutation.extend({ content: orderContent });

const warehouseHeader = {
  subjectId: id,
  warehouseId: id,
  occurredOn: z.iso.date(),
  reason,
  notes: note,
};
const sourceLine = { id, quantity, notes: note };
const knownLine = z.strictObject({
  id,
  selection: known,
  quality,
  notes: note,
});
const originalLine = { ...sourceLine, originalLineId: id };
const productionEvidence = z.strictObject({
  reference: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(6000),
  occurredOn: z.iso.date(),
  shiftReportId: id.optional(),
});
const lines = <T extends z.ZodType>(schema: T) =>
  z.array(schema).min(1).max(100);
export const warehouseContent = z
  .discriminatedUnion('kind', [
    z.strictObject({
      ...warehouseHeader,
      kind: z.literal('purchaseReceipt'),
      purchaseOrderId: id,
      lines: lines(
        z.strictObject({
          ...sourceLine,
          // Reference conversions require the counted stock quantity beside the
          // measured business quantity; exact conversions ignore it.
          baseQuantity: decimalText.optional(),
          purchaseOrderLineId: id,
          rejectedQuantity: decimalText.default('0'),
          quality: z.enum(['qualified', 'inspection']),
        }),
      ),
    }),
    z.strictObject({
      ...warehouseHeader,
      kind: z.literal('salesShipment'),
      salesOrderId: id,
      lines: lines(
        z.strictObject({
          ...sourceLine,
          baseQuantity: decimalText.optional(),
          salesOrderLineId: id,
        }),
      ),
    }),
    z.strictObject({
      ...warehouseHeader,
      kind: z.literal('issue'),
      issueRequestId: id,
      lines: lines(z.strictObject({ ...sourceLine, issueRequestLineId: id })),
    }),
    z.strictObject({
      ...warehouseHeader,
      kind: z.literal('purchaseReturn'),
      originalDocumentId: id,
      lines: lines(
        z.strictObject({
          ...originalLine,
          quality,
          replenishmentRequested: z.boolean(),
        }),
      ),
    }),
    z.strictObject({
      ...warehouseHeader,
      kind: z.literal('salesReturn'),
      originalDocumentId: id,
      lines: lines(z.strictObject({ ...originalLine, condition: reason })),
    }),
    z.strictObject({
      ...warehouseHeader,
      kind: z.literal('issueReturn'),
      originalDocumentId: id,
      lines: lines(
        z.strictObject({ ...originalLine, quality, condition: reason }),
      ),
    }),
    z.strictObject({
      ...warehouseHeader,
      kind: z.literal('productionReceipt'),
      productionEvidence,
      lines: lines(
        knownLine.refine((v) => v.quality !== 'frozen', {
          path: ['quality'],
          message: 'Receipt must be qualified or awaiting inspection.',
        }),
      ),
    }),
    z.strictObject({
      ...warehouseHeader,
      kind: z.literal('productionIssue'),
      productionEvidence,
      lines: lines(
        knownLine.refine((v) => v.quality === 'qualified', {
          path: ['quality'],
          message: 'Issue requires qualified stock.',
        }),
      ),
    }),
    z.strictObject({
      ...warehouseHeader,
      kind: z.literal('transferDispatch'),
      transferId: id,
      lines: lines(z.strictObject({ ...sourceLine, transferLineId: id })),
    }),
    z.strictObject({
      ...warehouseHeader,
      kind: z.literal('transferReceipt'),
      transferId: id,
      lines: lines(z.strictObject({ ...sourceLine, transferLineId: id })),
    }),
    z.strictObject({
      ...warehouseHeader,
      kind: z.literal('initial'),
      initializationReference: z.string().trim().min(1).max(200),
      lines: lines(knownLine),
    }),
    z.strictObject({
      ...warehouseHeader,
      kind: z.literal('loss'),
      lossEvidence: z.string().trim().min(1).max(6000),
      lines: lines(knownLine),
    }),
    z.strictObject({
      ...warehouseHeader,
      kind: z.literal('qualityTransfer'),
      inspectionEvidence: z.string().trim().min(1).max(6000),
      lines: lines(
        z.strictObject({
          ...sourceLine,
          sourceBalanceId: id,
          targetQuality: quality,
        }),
      ),
    }),
    z.strictObject({
      ...warehouseHeader,
      kind: z.literal('transferDiscrepancy'),
      transferId: id,
      evidence: z.string().trim().min(1).max(6000),
      lines: lines(z.strictObject({ ...sourceLine, transferLineId: id })),
    }),
    z.strictObject({
      ...warehouseHeader,
      kind: z.literal('reversal'),
      originalDocumentId: id,
      originalPostingId: id,
      evidence: z.string().trim().min(1).max(6000),
    }),
  ])
  .refine(
    (v) =>
      !('lines' in v) ||
      new Set(v.lines.map((line) => line.id)).size === v.lines.length,
    { path: ['lines'], message: 'Duplicate line IDs.' },
  );
export const warehouseCreate = z.strictObject({
  content: warehouseContent,
  requestKey: id,
});
export const warehouseUpdate = executionMutation.extend({
  content: warehouseContent,
});
export type WarehouseContent = z.infer<typeof warehouseContent>;

export const transferContent = z
  .strictObject({
    ...warehouseHeader,
    destinationWarehouseId: id,
    lines: lines(z.strictObject({ id, selection: known, notes: note })),
  })
  .refine((v) => v.warehouseId !== v.destinationWarehouseId, {
    path: ['destinationWarehouseId'],
    message: 'Choose a different warehouse.',
  })
  .refine(
    (v) => new Set(v.lines.map((line) => line.id)).size === v.lines.length,
    { path: ['lines'], message: 'Duplicate line IDs.' },
  );
export const transferCreate = z.strictObject({
  content: transferContent,
  requestKey: id,
});
export const transferUpdate = executionMutation.extend({
  content: transferContent,
});
export const countContent = z.strictObject({
  ...warehouseHeader,
  reason: z.string().trim().max(3000).default(''),
});
export const countCreate = z.strictObject({
  content: countContent,
  requestKey: id,
});
export const countUpdate = executionMutation.extend({
  content: countContent.extend({
    lines: z
      .array(
        z.strictObject({
          id,
          skuId: id,
          quality,
          actualQuantity: decimalText.nullable(),
          reason: z.string().trim().max(3000).default(''),
          notes: note,
        }),
      )
      .max(10000)
      .optional(),
  }),
});
export const executionQuantityAction = executionMutation.extend({
  lines: lines(z.strictObject({ lineId: id, quantity })),
});
export const inventoryQuery = executionPage.extend({
  subjectId: id,
  warehouseId: id.optional(),
  transferId: id.optional(),
  skuId: id.optional(),
  quality: quality.optional(),
  orderBy: z
    .enum([
      'code',
      '-code',
      'quantity',
      '-quantity',
      'reservedQuantity',
      '-reservedQuantity',
      'available',
      '-available',
    ])
    .default('code'),
});
export const inventoryReservationInput = z.strictObject({
  reservationId: id,
  sourceKind: z.enum(['issue', 'sales']),
  sourceId: id,
  sourceLineId: id,
  warehouseId: id,
  quantity,
  version: z.number().int().min(1),
  lifecycleVersion: z.number().int().min(0),
  reason,
  requestKey: id,
});
export const inventoryMovementQuery = inventoryQuery
  .omit({ orderBy: true })
  .extend({
    orderBy: z
      .enum(['occurredAt', '-occurredAt', 'deltaQuantity', '-deltaQuantity'])
      .default('-occurredAt'),
    balanceId: id.optional(),
    documentId: id.optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ['to'],
    message: 'Invalid date range.',
  });
export const inventoryReservationsQuery = inventoryQuery
  .omit({ orderBy: true })
  .extend({
    orderBy: z
      .enum([
        'createdAt',
        '-createdAt',
        'remainingQuantity',
        '-remainingQuantity',
      ])
      .default('-createdAt'),
    balanceId: id.optional(),
  });
export const inventoryReleaseInput = z.strictObject({
  quantity,
  version: z.number().int().min(1),
  reason,
  requestKey: id,
});
export const executionSettingsQuery = z.strictObject({
  subjectId: id,
  kind: z.enum(executionKinds),
});
export const executionSettingsSave = executionSettingsQuery.extend({
  values: executionRules,
  version: z.number().int().min(0),
  requestKey: id,
});
export type ExecutionQuery = z.infer<typeof executionQuery>;
export type OrderContent = z.infer<typeof orderContent>;

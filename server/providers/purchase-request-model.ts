import { attachmentInput } from './supply-chain-file-model.js';
import { z } from 'zod';
import { materialSelectionInput } from './supply-chain-model.js';

const id = z.string().uuid();
const optionalId = id.nullable().default(null);
const note = z.string().trim().max(6000).default('');
export const purchaseStates = [
  'draft',
  'pending',
  'approved',
  'cancelled',
] as const;
export const purchaseTransitions = [
  'submit',
  'approve',
  'return',
  'withdraw',
  'revise',
  'cancel',
  'reassign',
] as const;
export const purchaseSourceChannels = [
  'manual',
  'import',
  'api',
  'device',
] as const;
export type PurchaseSourceChannel = (typeof purchaseSourceChannels)[number];

export const purchaseLineInput = z.strictObject({
  id,
  selection: materialSelectionInput,
  originalName: z.string().trim().max(200).default(''),
  originalSpecification: z.string().trim().max(6000).default(''),
  usage: note,
  notes: note,
});
export const purchaseContent = z
  .strictObject({
    attachments: z.array(attachmentInput).max(10).optional(),
    subjectId: id,
    requesterEmployeeId: optionalId,
    requestingUnitId: optionalId,
    usage: note,
    neededOn: z.iso.date().nullable().default(null),
    businessDate: z.iso.date().nullable().default(null),
    sourceChannel: z.enum(purchaseSourceChannels).default('manual'),
    suggestedSupplierId: optionalId,
    projectId: z.null().default(null),
    notes: note,
    lines: z.array(purchaseLineInput).max(100).default([]),
  })
  .refine(
    (v) => new Set(v.lines.map((line) => line.id)).size === v.lines.length,
    { path: ['lines'], message: 'Duplicate line IDs.' },
  )
  .refine(
    (v) => v.lines.every((line) => line.selection.subjectId === v.subjectId),
    { path: ['lines'], message: 'Line company must match the request.' },
  );
export const purchaseCreate = z.strictObject({
  content: purchaseContent,
  requestKey: id,
});
export const purchaseMutation = z.strictObject({
  version: z.number().int().min(1),
  lifecycleVersion: z.number().int().min(1),
  requestKey: id,
  reason: z.string().trim().min(1).max(3000),
});
export const purchaseUpdate = purchaseMutation.extend({
  content: purchaseContent,
});
export const purchaseAction = purchaseMutation.extend({
  transition: z.enum(purchaseTransitions),
});
export const purchaseParams = z.object({ id });
export const purchasePage = z.strictObject({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const purchaseQuery = purchasePage.extend({
  subjectId: id.optional(),
  status: z.enum(purchaseStates).optional(),
  mine: z.enum(['true', 'false']).default('false'),
  submitted: z.enum(['true', 'false']).default('false'),
  identification: z.enum(['identified', 'unidentified']).optional(),
  neededFrom: z.iso.date().optional(),
  neededTo: z.iso.date().optional(),
  orderBy: z
    .enum(['updatedAt', '-updatedAt', 'neededOn', '-neededOn'])
    .default('-updatedAt'),
});
export const purchaseMergeQuery = z.strictObject({
  subjectId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  neededFrom: z.iso.date().optional(),
  neededTo: z.iso.date().optional(),
});
export const purchaseOptionQuery = purchasePage.extend({
  subjectId: id,
  kind: z.enum(['employees', 'units', 'positions', 'reviewers']),
  requesterEmployeeId: id.optional(),
});
export const purchaseRules = z.strictObject({
  reviewerSelections: z
    .array(
      z.strictObject({
        group: z.number().int().min(1).max(100),
        type: z.enum(['position', 'user']),
        referenceId: z.string().trim().min(1).max(200),
      }),
    )
    .max(100),
  allowParallelGovernance: z.boolean(),
  requireProject: z.literal(false),
});
export const purchaseSettingsSave = z.strictObject({
  subjectId: id,
  version: z.number().int().min(0),
  requestKey: id,
  values: purchaseRules,
});
export const purchaseSettingsQuery = z.strictObject({ subjectId: id });
export type PurchaseContent = z.infer<typeof purchaseContent>;
export type PurchaseCreate = z.infer<typeof purchaseCreate>;
export type PurchaseMutation = z.infer<typeof purchaseMutation>;
export type PurchaseUpdate = z.infer<typeof purchaseUpdate>;
export type PurchaseAction = z.infer<typeof purchaseAction>;
export type PurchaseQuery = z.infer<typeof purchaseQuery>;
export type PurchaseMergeQuery = z.infer<typeof purchaseMergeQuery>;
export type PurchasePage = z.infer<typeof purchasePage>;
export type PurchaseOptionQuery = z.infer<typeof purchaseOptionQuery>;
export type PurchaseRules = z.infer<typeof purchaseRules>;
export type PurchaseSettingsSave = z.infer<typeof purchaseSettingsSave>;

export const purchaseHeadColumns = [
  'id',
  'code',
  'subjectId',
  'requesterEmployeeId',
  'requesterAccountId',
  'requestingUnitId',
  'usage',
  'neededOn',
  'businessDate',
  'sourceChannel',
  'suggestedSupplierId',
  'supplierSnapshot',
  'notes',
  'status',
  'statusChangedAt',
  'lifecycleVersion',
  'revision',
  'contentVersion',
  'governanceEpoch',
  'reviewRound',
  'identifiedCount',
  'identificationStatus',
  'lineCount',
  'submittedVersionId',
  'approvedVersionId',
  'parameterContract',
  'supersedesId',
  'createdBy',
  'updatedBy',
  'submittedBy',
  'submittedAt',
  'approvedAt',
  'createdAt',
  'updatedAt',
];
export const purchaseLineColumns = [
  'id',
  'requestId',
  'subjectId',
  'lineNo',
  'status',
  'revision',
  'inputRevision',
  'governanceAttempt',
  'originalName',
  'originalSpecification',
  'requestedQuantity',
  'requestedUnitText',
  'requestedUnitId',
  'materialNameId',
  'skuId',
  'skuRevision',
  'managementModeSnapshot',
  'unitId',
  'unitRuleId',
  'unitRuleRevision',
  'numeratorSnapshot',
  'denominatorSnapshot',
  'baseUnitId',
  'baseQuantity',
  'identificationStatus',
  'activeSourceLinkId',
  'materialSnapshot',
  'confirmedBy',
  'confirmedAt',
  'usage',
  'notes',
  'selectionInput',
];
export const purchaseVersionColumns = [
  'id',
  'kind',
  'requestId',
  'subjectId',
  'contentVersion',
  'payload',
  'createdAt',
];
export const purchaseTaskColumns = [
  'id',
  'kind',
  'requestId',
  'subjectId',
  'round',
  'versionId',
  'candidates',
  'excludedActors',
  'status',
  'decidedBy',
  'reason',
  'decidedAt',
  'createdAt',
];
// Public responses are explicit projections; private replay/parameter rows have no routes.
const record = z.record(z.string(), z.unknown());
export const purchaseView = z
  .object({
    id,
    code: z.string(),
    subjectId: id,
    status: z.enum(purchaseStates),
    revision: z.number().int(),
    lifecycleVersion: z.number().int(),
    contentVersion: z.number().int(),
    lines: z.array(record),
    versions: z.array(record),
    reviewTasks: z.array(record),
  })
  .catchall(z.unknown());
export const purchaseListView = z
  .object({
    id,
    code: z.string(),
    subjectId: id,
    status: z.enum(purchaseStates),
  })
  .catchall(z.unknown());
export const purchaseMeta = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export const purchaseSettingsView = z.object({
  subjectId: id,
  revision: z.number().int(),
  values: purchaseRules,
  schemaVersion: z.literal(1),
  readMode: z.literal('snapshot'),
  fields: z.array(
    z.object({
      key: z.string(),
      type: z.enum(['reviewers', 'boolean']),
      title: z.string(),
    }),
  ),
  references: z.array(
    z.object({
      type: z.enum(['position', 'user']),
      referenceId: z.string(),
      group: z.number().int(),
      code: z.string().optional(),
      name: z.string().optional(),
      availability: z.enum(['active', 'inactive', 'unavailable']),
    }),
  ),
});
export const purchaseOptionView = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
});
export const purchaseIdentityView = z.object({
  employee: z.object({ id, code: z.string(), name: z.string() }).nullable(),
  companies: z.array(
    z.object({
      id,
      code: z.string(),
      name: z.string(),
      primary: z.boolean(),
      units: z.array(
        z.object({
          id,
          code: z.string(),
          name: z.string(),
          positionId: id,
          positionCode: z.string(),
          positionName: z.string(),
          primary: z.boolean(),
        }),
      ),
    }),
  ),
  default: z.object({ subjectId: id, unitId: id.nullable() }).nullable(),
});
export const purchaseMergeView = z.object({
  key: z.string(),
  kind: z.enum(['known', 'unknown']),
  material: z.object({
    skuId: id.nullable(),
    code: z.string(),
    name: z.string(),
    specification: z.string(),
    unitId: id.nullable(),
    unitName: z.string(),
  }),
  quantity: z.string(),
  sources: z.array(
    z.object({
      requestId: id,
      requestCode: z.string(),
      subjectId: id,
      companyName: z.string(),
      lineId: id,
      lineNo: z.number().int(),
      requestedQuantity: z.string(),
      requestedUnit: z.string(),
      baseQuantity: z.string().nullable(),
      baseUnit: z.string().nullable(),
      neededOn: z.string().nullable(),
      usage: z.string(),
    }),
  ),
});
export const purchaseAuditView = z
  .object({
    id,
    operation: z.string(),
    reason: z.string(),
    actorId: z.string(),
    createdAt: z.string(),
  })
  .catchall(z.unknown());

export const purchaseCapabilityView = z.object({
  recordRevision: z.number().int(),
  lifecycleVersion: z.number().int(),
  actions: z.record(
    z.string(),
    z.object({
      visible: z.boolean(),
      enabled: z.boolean(),
      reason: z.string().nullable(),
    }),
  ),
});
export const purchaseCompanyMeta = purchaseMeta.extend({
  businessDate: z.iso.date(),
  timeZone: z.string(),
});

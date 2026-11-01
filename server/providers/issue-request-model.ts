import { attachmentInput } from './supply-chain-file-model.js';
import { z } from 'zod';
import { materialSelectionInput } from './supply-chain-model.js';

const id = z.string().uuid();
const optionalId = id.nullable().default(null);
const note = z.string().trim().max(6000).default('');
export const issueStates = [
  'draft',
  'pending',
  'approved',
  'cancelled',
] as const;
export const issueFulfillmentStatuses = [
  'open',
  'partial',
  'issued',
  'received',
] as const;
export const issueTransitions = [
  'submit',
  'approve',
  'return',
  'withdraw',
  'revise',
  'cancel',
  'reassign',
] as const;
export const issueLineInput = z.strictObject({
  id,
  selection: materialSelectionInput,
  originalName: z.string().trim().max(200).default(''),
  originalSpecification: z.string().trim().max(6000).default(''),
  usage: note,
  notes: note,
});
export const issueContent = z
  .strictObject({
    attachments: z.array(attachmentInput).max(10).optional(),
    subjectId: id,
    requesterEmployeeId: optionalId,
    recipientEmployeeId: optionalId,
    requestingUnitId: optionalId,
    usage: note,
    neededOn: z.iso.date().nullable().default(null),
    purposeId: optionalId,
    projectId: z.null().default(null),
    notes: note,
    lines: z.array(issueLineInput).max(100).default([]),
  })
  .refine(
    (v) => new Set(v.lines.map((line) => line.id)).size === v.lines.length,
    { path: ['lines'], message: 'Duplicate line IDs.' },
  )
  .refine(
    (v) => v.lines.every((line) => line.selection.subjectId === v.subjectId),
    { path: ['lines'], message: 'Line company must match the request.' },
  );
export const issueCreate = z.strictObject({
  content: issueContent,
  requestKey: id,
});
export const issueMutation = z.strictObject({
  version: z.number().int().min(1),
  lifecycleVersion: z.number().int().min(1),
  requestKey: id,
  reason: z.string().trim().min(1).max(3000),
});
export const issueUpdate = issueMutation.extend({
  content: issueContent,
});
export const issueAction = issueMutation.extend({
  transition: z.enum(issueTransitions),
});
export const issueReceive = z.strictObject({
  version: z.number().int().min(1),
  note,
});
export const issueParams = z.object({ id });
export const issuePage = z.strictObject({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const issueQuery = issuePage.extend({
  subjectId: id,
  status: z.enum(issueStates).optional(),
  fulfillmentStatus: z.enum(issueFulfillmentStatuses).optional(),
  mine: z.enum(['true', 'false']).default('false'),
  identification: z.enum(['identified', 'unidentified']).optional(),
  neededFrom: z.iso.date().optional(),
  neededTo: z.iso.date().optional(),
  orderBy: z
    .enum(['updatedAt', '-updatedAt', 'neededOn', '-neededOn'])
    .default('-updatedAt'),
});
export const issueOptionQuery = issuePage.extend({
  subjectId: id,
  kind: z.enum(['employees', 'units', 'positions', 'reviewers']),
  requesterEmployeeId: id.optional(),
});
export const issueRules = z.strictObject({
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
export const issueSettingsSave = z.strictObject({
  subjectId: id,
  version: z.number().int().min(0),
  requestKey: id,
  values: issueRules,
});
export const issueSettingsQuery = z.strictObject({ subjectId: id });
export type IssueContent = z.infer<typeof issueContent>;
export type IssueCreate = z.infer<typeof issueCreate>;
export type IssueMutation = z.infer<typeof issueMutation>;
export type IssueUpdate = z.infer<typeof issueUpdate>;
export type IssueAction = z.infer<typeof issueAction>;
export type IssueReceive = z.infer<typeof issueReceive>;
export type IssueQuery = z.infer<typeof issueQuery>;
export type IssuePage = z.infer<typeof issuePage>;
export type IssueOptionQuery = z.infer<typeof issueOptionQuery>;
export type IssueRules = z.infer<typeof issueRules>;
export type IssueSettingsSave = z.infer<typeof issueSettingsSave>;

export const issueHeadColumns = [
  'id',
  'code',
  'subjectId',
  'requesterEmployeeId',
  'recipientEmployeeId',
  'recipientAccountId',
  'requesterAccountId',
  'requestingUnitId',
  'usage',
  'neededOn',
  'purposeId',
  'purposeSnapshot',
  'notes',
  'status',
  'fulfillmentStatus',
  'issuedAt',
  'issuedBy',
  'receivedAt',
  'receivedBy',
  'receiptNote',
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
export const issueLineColumns = [
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
export const issueVersionColumns = [
  'id',
  'kind',
  'issueRequestId',
  'subjectId',
  'contentVersion',
  'payload',
  'createdAt',
];
export const issueTaskColumns = [
  'id',
  'kind',
  'issueRequestId',
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
export const issueView = z
  .object({
    id,
    code: z.string(),
    subjectId: id,
    status: z.enum(issueStates),
    revision: z.number().int(),
    lifecycleVersion: z.number().int(),
    contentVersion: z.number().int(),
    lines: z.array(record),
    versions: z.array(record),
    reviewTasks: z.array(record),
  })
  .catchall(z.unknown());
export const issueListView = z
  .object({
    id,
    code: z.string(),
    subjectId: id,
    status: z.enum(issueStates),
  })
  .catchall(z.unknown());
export const issueMeta = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export const issueSettingsView = z.object({
  subjectId: id,
  revision: z.number().int(),
  values: issueRules,
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
export const issueOptionView = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
});
export const issueAuditView = z
  .object({
    id,
    operation: z.string(),
    reason: z.string(),
    actorId: z.string(),
    createdAt: z.string(),
  })
  .catchall(z.unknown());

export const issueCapabilityView = z.object({
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
export const issueCompanyMeta = issueMeta.extend({
  businessDate: z.iso.date(),
  timeZone: z.string(),
});

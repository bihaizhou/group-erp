import { z } from 'zod';
import { ApiError } from '@nocobase/app-server/router';
import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';
import type { LifecycleActor, JsonObject } from '@nocobase/lifecycle';
import type { MaterialPolicies } from './material-service.js';

const id = z.string().uuid(),
  version = z.number().int().min(1);
export const sourceKinds = [
  'purchaseRequestLine',
  'materialIssueRequestLine',
] as const;
export type SourceKind = (typeof sourceKinds)[number];
export const sourceParams = z.object({ id, lineId: id });
export const sourceMutation = z.strictObject({
  version,
  lifecycleVersion: version,
  lineVersion: version,
  inputRevision: version,
  requestKey: id,
  reason: z.string().trim().min(1).max(3000),
});
export const sourceRequest = sourceMutation.extend({
  sourceVersion: version.optional(),
  retry: z.boolean().default(false),
});
export const sourceConfirm = sourceMutation.extend({
  sourceId: id,
  sourceVersion: version,
  unitId: id,
  unitRuleId: id.nullable(),
});
export const sourceDecision = sourceMutation.extend({
  sourceId: id,
  sourceVersion: version,
});
export const sourceColumns = [
  'id',
  'requestId',
  'sourceKind',
  'purchaseRequestLineId',
  'materialIssueRequestLineId',
  'sourceDocumentId',
  'subjectId',
  'sourceInputRevision',
  'sourceEpoch',
  'sourceAttempt',
  'revision',
  'status',
  'proposedSkuId',
  'offeredAt',
  'inputSnapshot',
  'resolutionSnapshot',
  'requestedBy',
  'sourceHandlerId',
  'reason',
  'invalidatedReason',
  'createdAt',
  'updatedAt',
];
export interface SourceAccess {
  policies: MaterialPolicies;
  delegate: MaterialPolicies | null;
}
// These ports accept a transaction already locked by the source coordinator.
// They expose neither arbitrary collection names nor public lifecycle transitions.
export interface DemandSourcePort {
  kind: SourceKind;
  domain: 'procurement' | 'requisitions';
  headTable: 'purchaseRequests' | 'materialIssueRequests';
  lineTable: 'purchaseRequestLines' | 'materialIssueRequestLines';
  authorized(
    c: DatabaseConnection,
    id: string,
    actor: LifecycleActor,
    access: SourceAccess,
  ): Promise<RepositoryRecord>;
  mutate(
    c: DatabaseConnection,
    id: string,
    actor: LifecycleActor,
    access: SourceAccess,
    input: {
      updates: JsonObject;
      confirmed: boolean;
      reason: string;
      requestKey: string;
      auditActor?: LifecycleActor;
    },
  ): Promise<JsonObject>;
}
export interface DemandSourceHooks {
  checkSubmission(
    c: DatabaseConnection,
    kind: SourceKind,
    documentId: string,
    actor: LifecycleActor,
    access: SourceAccess | undefined,
  ): Promise<void>;
  submit(
    c: DatabaseConnection,
    kind: SourceKind,
    documentId: string,
    actor: LifecycleActor,
    access: SourceAccess | undefined,
    reason: string,
  ): Promise<void>;
  invalidate(
    c: DatabaseConnection,
    kind: SourceKind,
    documentId: string,
    actor: LifecycleActor,
    reason: string,
    lineIds?: string[],
  ): Promise<void>;
}
export function sourceError(
  reason: string,
  status: ConstructorParameters<
    typeof ApiError
  >[0]['status'] = 'FAILED_PRECONDITION',
): never {
  throw new ApiError({
    status,
    domain: 'supplyChain',
    reason,
    message: 'The material source operation could not be completed.',
  });
}

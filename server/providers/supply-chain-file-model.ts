import { z } from 'zod';
import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';
import type { LifecycleActor } from '@nocobase/lifecycle';
import type { SourceAccess, SourceKind } from './material-source-model.js';
import type { MaterialPolicies } from './material-service.js';
export const attachmentInput = z
  .strictObject({
    fileId: z.string().uuid(),
    lineId: z.string().uuid().nullable(),
    shareWithGovernance: z.boolean().default(false),
  })
  .refine((v) => !v.shareWithGovernance || !!v.lineId, {
    path: ['shareWithGovernance'],
    message: 'Only line attachments may be shared.',
  });
export type Attachment = z.infer<typeof attachmentInput>;
export type FileKind = 'purchaseRequest' | 'materialIssueRequest';
export const fileDomain = (kind: FileKind) =>
  kind === 'purchaseRequest' ? 'procurement' : 'requisitions';
export const fileKind = (domain: 'procurement' | 'requisitions'): FileKind =>
  domain === 'procurement' ? 'purchaseRequest' : 'materialIssueRequest';
export const sourceKind = (kind: FileKind): SourceKind =>
  kind === 'purchaseRequest'
    ? 'purchaseRequestLine'
    : 'materialIssueRequestLine';
export const fileTables = (kind: FileKind) =>
  kind === 'purchaseRequest'
    ? ({
        head: 'purchaseRequests',
        line: 'purchaseRequestLines',
        parent: 'purchaseRequestId',
        lineKey: 'purchaseLineId',
      } as const)
    : ({
        head: 'materialIssueRequests',
        line: 'materialIssueRequestLines',
        parent: 'issueRequestId',
        lineKey: 'issueLineId',
      } as const);
export interface FileDemandPort {
  read(
    c: DatabaseConnection,
    id: string,
    access: SourceAccess,
  ): Promise<RepositoryRecord>;
  edit(
    c: DatabaseConnection,
    id: string,
    actor: LifecycleActor,
    access: SourceAccess,
  ): Promise<RepositoryRecord>;
}
export interface DemandFileHooks {
  assertReadable(
    c: DatabaseConnection,
    kind: FileKind,
    id: string,
    files: unknown,
    policies: MaterialPolicies,
  ): Promise<void>;
  read(
    c: DatabaseConnection,
    kind: FileKind,
    id: string,
    versionId?: string,
    policies?: MaterialPolicies,
  ): Promise<Attachment[]>;
  save(
    c: DatabaseConnection,
    kind: FileKind,
    head: RepositoryRecord,
    files: Attachment[] | undefined,
    actor: LifecycleActor,
    policies: MaterialPolicies,
  ): Promise<void>;
  freeze(
    c: DatabaseConnection,
    kind: FileKind,
    head: RepositoryRecord,
    versionId: string,
  ): Promise<void>;
}

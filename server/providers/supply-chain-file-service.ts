import { randomUUID } from 'node:crypto';
import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryRecord,
} from '@nocobase/db';
import type { LifecycleActor } from '@nocobase/lifecycle';
import { ApiError } from '@nocobase/app-server/router';
import {
  attachmentInput,
  fileTables,
  sourceKind,
  type Attachment,
  type FileKind,
  type FileDemandPort,
  type DemandFileHooks,
} from './supply-chain-file-model.js';
import type { SourceAccess } from './material-source-model.js';
import type { MaterialPolicies } from './material-service.js';
import type { MaterialSourceService } from './material-source-service.js';
const text = (v: unknown) => (typeof v === 'string' ? v : '');
export function fileError(
  reason: string,
  status: ConstructorParameters<
    typeof ApiError
  >[0]['status'] = 'FAILED_PRECONDITION',
): never {
  throw new ApiError({
    status,
    domain: 'supplyChain',
    reason,
    message: 'The attachment operation could not be completed.',
  });
}
export class SupplyChainFileService implements DemandFileHooks {
  private readonly ports = new Map<FileKind, FileDemandPort>();
  constructor(
    private readonly db: DatabaseManager,
    private readonly sources: MaterialSourceService,
  ) {}
  register(kind: FileKind, port: FileDemandPort) {
    this.ports.set(kind, port);
  }
  private port(kind: FileKind) {
    const port = this.ports.get(kind);
    if (!port) return fileError('SUPPLY_FILE_UNAVAILABLE');
    return port;
  }
  async parent(
    kind: FileKind,
    id: string,
    actor: LifecycleActor,
    access: SourceAccess,
    write = false,
  ) {
    const c = this.db.connection();
    return write
      ? this.port(kind).edit(c, id, actor, access)
      : this.port(kind).read(c, id, access);
  }
  async read(
    c: DatabaseConnection,
    kind: FileKind,
    id: string,
    versionId?: string,
    policies?: MaterialPolicies,
  ): Promise<Attachment[]> {
    const rows = await c.repository('supplyChainFileLinks').findMany({
      filter: { kind, documentId: id, versionKey: versionId ?? 'current' },
      limit: 11,
    });
    if (rows.length > 10) return fileError('SUPPLY_FILE_LIMIT');
    const key = fileTables(kind).lineKey;
    const visible = [];
    for (const row of rows) {
      if (row[key] && policies) {
        const policy = policies[fileTables(kind).line];
        if (
          !policy ||
          policy.read === false ||
          !(await c
            .repository(fileTables(kind).line)
            .withPolicy(policy)
            .exists({ filter: { id: text(row[key]), requestId: id } }))
        )
          continue;
      }
      visible.push(row);
    }
    return visible.map((row) => ({
      fileId: text(row.fileId),
      lineId: row[key] ? text(row[key]) : null,
      shareWithGovernance: row.shareWithGovernance === true,
    }));
  }
  async save(
    c: DatabaseConnection,
    kind: FileKind,
    head: RepositoryRecord,
    files: Attachment[] | undefined,
    actor: LifecycleActor,
    policies: MaterialPolicies,
  ) {
    if (files === undefined) return;
    const input = attachmentInput.array().max(10).parse(files),
      id = text(head.id),
      tables = fileTables(kind);
    if (head.status !== 'draft') return fileError('SUPPLY_FILE_DRAFT_REQUIRED');
    if (new Set(input.map((f) => f.fileId)).size !== input.length)
      return fileError('SUPPLY_FILE_DUPLICATE');
    const old = await this.read(c, kind, id);
    const lineAccess = new Map<string, boolean>();
    const canChange = async (lineId: string) => {
      if (lineAccess.has(lineId)) return lineAccess.get(lineId)!;
      const policy = policies[tables.line],
        line = await c
          .repository(tables.line)
          .findOne({ filter: { id: lineId, requestId: id } });
      let allowed = false;
      if (policy?.read && policy.update && line) {
        const repo = c.repository(tables.line).withPolicy(policy);
        const validation = await repo.validateMutation({
          operation: 'updateOne',
          filter: { id: lineId },
          values: {
            revision: line.revision,
            inputRevision: line.inputRevision,
          },
        });
        allowed =
          validation.valid &&
          (await repo.exists({ filter: { id: lineId, requestId: id } })) &&
          (await c
            .repository(tables.line)
            .withPolicy({
              ...policy,
              read:
                policy.update === true
                  ? true
                  : { scope: policy.update.scope, fields: ['id'] },
            })
            .exists({ filter: { id: lineId } }));
      }
      lineAccess.set(lineId, allowed);
      return allowed;
    };
    // Partial line grants cannot rewrite or remove attachments outside their
    // line scope. Preserve unseen references when a scoped editor saves the
    // visible portion, and reject an explicit attempt to alter them.
    for (const previous of old) {
      if (!previous.lineId || (await canChange(previous.lineId))) continue;
      const incoming = input.find((file) => file.fileId === previous.fileId);
      if (
        incoming &&
        (incoming.lineId !== previous.lineId ||
          incoming.shareWithGovernance !== previous.shareWithGovernance)
      )
        return fileError('SUPPLY_FILE_FORBIDDEN', 'PERMISSION_DENIED');
      if (!incoming) input.push(previous);
    }
    if (input.length > 10) return fileError('SUPPLY_FILE_LIMIT');
    for (const [index, item] of input.entries()) {
      const previous = old.find((file) => file.fileId === item.fileId);
      if (
        item.lineId &&
        (!previous ||
          previous.lineId !== item.lineId ||
          previous.shareWithGovernance !== item.shareWithGovernance) &&
        !(await canChange(item.lineId))
      )
        return fileError('SUPPLY_FILE_FORBIDDEN', 'PERMISSION_DENIED');
      const file = await c.repository('supplyChainFiles').findOne({
        filter: {
          id: item.fileId,
          documentId: id,
          kind,
          subjectId: text(head.subjectId),
        },
      });
      if (!file) return fileError('SUPPLY_FILE_NOT_FOUND', 'NOT_FOUND');
      // A delegate may retain a bound file; only its uploader may first bind an
      // unreferenced upload. A parent ID or a known UUID is not an upload grant.
      if (
        file.ownerId !== actor.id &&
        !(await c
          .repository('supplyChainFileLinks')
          .exists({ filter: { fileId: item.fileId, documentId: id } }))
      )
        return fileError('SUPPLY_FILE_FORBIDDEN', 'PERMISSION_DENIED');
      if (
        item.lineId &&
        !(await c.repository(tables.line).exists({
          filter: {
            id: item.lineId,
            requestId: id,
            subjectId: text(head.subjectId),
            status: 'active',
          },
        }))
      )
        throw new ApiError({
          status: 'INVALID_ARGUMENT',
          domain: 'supplyChain',
          reason: 'SUPPLY_FILE_LINE_INVALID',
          message: 'Invalid attachment line.',
          fieldViolations: [
            {
              field: `attachments.${index}.lineId`,
              description: 'SUPPLY_FILE_LINE_INVALID',
            },
          ],
        });
    }
    const shared = (items: Attachment[], lineId: string) =>
      items
        .filter((f) => f.lineId === lineId && f.shareWithGovernance)
        .map((f) => f.fileId)
        .sort()
        .join(',');
    const lineIds = [
      ...new Set(
        [...old, ...input].flatMap((f) => (f.lineId ? [f.lineId] : [])),
      ),
    ].filter((lineId) => shared(old, lineId) !== shared(input, lineId));
    if (lineIds.length) {
      await this.sources.invalidate(
        c,
        sourceKind(kind),
        id,
        actor,
        'SYSTEM_SOURCE_SHARED_FILES_CHANGED',
        lineIds,
      );
      for (const lineId of lineIds) {
        const line = await c
          .repository(tables.line)
          .findOne({ filter: { id: lineId, requestId: id } });
        if (line)
          await c.repository(tables.line).updateOne({
            filter: { id: lineId, revision: Number(line.revision) },
            values: {
              inputRevision: Number(line.inputRevision) + 1,
              revision: Number(line.revision) + 1,
            },
          });
      }
    }
    const previous = await c.repository('supplyChainFileLinks').findMany({
      filter: { kind, documentId: id, versionKey: 'current' },
      limit: 11,
    });
    for (const link of previous)
      await c
        .repository('supplyChainFileLinks')
        .deleteOne({ filter: { id: text(link.id) } });
    for (const file of input)
      await c.repository('supplyChainFileLinks').createOne({
        values: {
          id: randomUUID(),
          kind,
          documentId: id,
          subjectId: head.subjectId,
          purchaseRequestId: kind === 'purchaseRequest' ? id : null,
          issueRequestId: kind === 'materialIssueRequest' ? id : null,
          purchaseLineId: kind === 'purchaseRequest' ? file.lineId : null,
          issueLineId: kind === 'materialIssueRequest' ? file.lineId : null,
          fileId: file.fileId,
          versionId: null,
          versionKey: 'current',
          shareWithGovernance: file.shareWithGovernance,
          createdAt: new Date(),
        },
      });
  }
  async freeze(
    c: DatabaseConnection,
    kind: FileKind,
    head: RepositoryRecord,
    versionId: string,
  ) {
    const existing = await c.repository('supplyChainFileLinks').exists({
      filter: { kind, documentId: text(head.id), versionKey: versionId },
    });
    if (existing) return;
    const rows = await c.repository('supplyChainFileLinks').findMany({
      filter: { kind, documentId: text(head.id), versionKey: 'current' },
      limit: 11,
    });
    if (rows.length > 10) return fileError('SUPPLY_FILE_LIMIT');
    for (const row of rows)
      await c.repository('supplyChainFileLinks').createOne({
        values: {
          ...row,
          id: randomUUID(),
          versionId,
          versionKey: versionId,
          createdAt: new Date(),
        },
      });
  }
  private async linkedFileIds(
    c: DatabaseConnection,
    kind: FileKind,
    id: string,
    policies: MaterialPolicies,
  ) {
    const links = await c
      .repository('supplyChainFileLinks')
      .findMany({ filter: { kind, documentId: id }, limit: 10001 });
    if (links.length > 10000) return fileError('SUPPLY_FILE_LIMIT');
    const result = new Set<string>(),
      tables = fileTables(kind);
    for (const link of links) {
      if (link[tables.lineKey]) {
        const policy = policies[tables.line];
        if (
          !policy ||
          policy.read === false ||
          !(await c
            .repository(tables.line)
            .withPolicy(policy)
            .exists({
              filter: { id: text(link[tables.lineKey]), requestId: id },
            }))
        )
          continue;
      }
      result.add(text(link.fileId));
    }
    return [...result];
  }
  async assertReadable(
    c: DatabaseConnection,
    kind: FileKind,
    id: string,
    files: unknown,
    policies: MaterialPolicies,
  ) {
    const input = attachmentInput
      .array()
      .max(10)
      .parse(files ?? []);
    if (!input.length) return;
    const allowed = await this.linkedFileIds(c, kind, id, policies);
    if (input.some((file) => !allowed.includes(file.fileId)))
      return fileError('SUPPLY_FILE_FORBIDDEN', 'PERMISSION_DENIED');
  }
  async parentFileIds(
    kind: FileKind,
    id: string,
    actor: LifecycleActor,
    access: SourceAccess,
    writeAccess?: SourceAccess,
  ) {
    const c = this.db.connection(),
      head = await this.port(kind).read(c, id, access);
    const result = new Set(
      await this.linkedFileIds(c, kind, id, access.policies),
    );
    if (!writeAccess) return [...result];
    try {
      await this.port(kind).edit(c, id, actor, writeAccess);
      const owned = await c.repository('supplyChainFiles').findMany({
        filter: {
          kind,
          documentId: id,
          ownerId: actor.id,
          subjectId: text(head.subjectId),
        },
        limit: 10001,
      });
      if (owned.length > 10000) return fileError('SUPPLY_FILE_LIMIT');
      for (const file of owned)
        if (
          !(await c
            .repository('supplyChainFileLinks')
            .exists({ filter: { fileId: text(file.id) } }))
        )
          result.add(text(file.id));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
    return [...result];
  }
  async governanceIds(taskId: string, policies: MaterialPolicies) {
    const c = this.db.connection();
    if (
      !policies.materialRequests ||
      !policies.materialRequestSources ||
      !(await c
        .repository('materialRequests')
        .withPolicy(policies.materialRequests)
        .exists({ filter: { id: taskId } }))
    )
      return fileError('SUPPLY_FILE_FORBIDDEN', 'PERMISSION_DENIED');
    const source = await c
      .repository('materialRequestSources')
      .withPolicy(policies.materialRequestSources)
      .findOne({ filter: { requestId: taskId } });
    if (!source || source.status === 'invalidated') return [];
    const kind: FileKind =
        source.sourceKind === 'purchaseRequestLine'
          ? 'purchaseRequest'
          : 'materialIssueRequest',
      tables = fileTables(kind),
      lineId = text(
        source.purchaseRequestLineId || source.materialIssueRequestLineId,
      );
    const head = await c
        .repository(tables.head)
        .findOne({ filter: { id: text(source.sourceDocumentId) } }),
      line = await c
        .repository(tables.line)
        .findOne({ filter: { id: lineId } });
    if (
      !head ||
      !line ||
      head.status === 'cancelled' ||
      line.status !== 'active' ||
      line.activeSourceLinkId !== source.id ||
      head.governanceEpoch !== source.sourceEpoch ||
      Number(line.inputRevision) !==
        Number(source.sourceInputRevision) +
          (source.status === 'applied' ? 1 : 0)
    )
      return [];
    return (await this.read(c, kind, text(head.id)))
      .filter((f) => f.lineId === lineId && f.shareWithGovernance)
      .map((f) => f.fileId);
  }
  async file(id: string) {
    return this.db.repository('supplyChainFiles').findOne({ filter: { id } });
  }
  async currentTaskForFile(id: string) {
    const c = this.db.connection(),
      link = await c.repository('supplyChainFileLinks').findOne({
        filter: {
          fileId: id,
          versionKey: 'current',
          shareWithGovernance: true,
        },
      });
    if (!link) return null;
    const kind = link.kind as FileKind,
      tables = fileTables(kind),
      line = await c.repository(tables.line).findOne({
        filter: {
          id: text(link[tables.lineKey]),
          requestId: text(link.documentId),
        },
      });
    if (!line?.activeSourceLinkId) return null;
    const source = await c.repository('materialRequestSources').findOne({
      filter: {
        id: text(line.activeSourceLinkId),
        sourceDocumentId: text(link.documentId),
      },
    });
    return source ? text(source.requestId) : null;
  }
}

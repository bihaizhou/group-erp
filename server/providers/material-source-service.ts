import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryRecord,
} from '@nocobase/db';
import type {
  JsonObject,
  LifecycleActor,
  LifecycleRuntime,
  TransitionHookContext,
} from '@nocobase/lifecycle';
import type { MaterialService, MaterialPolicies } from './material-service.js';
import type { SupplyChainMaterialService } from './supply-chain-material-service.js';
import type { MaterialLifecycleTypes } from './material-workflows.js';
import {
  sourceError as fail,
  sourceColumns,
  type SourceKind,
  type SourceAccess,
  type DemandSourcePort,
  type DemandSourceHooks,
  sourceRequest,
  sourceConfirm,
  sourceDecision,
} from './material-source-model.js';
import { z } from 'zod';

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const json = (v: unknown): JsonObject =>
  JSON.parse(JSON.stringify(v)) as JsonObject;
const canonical = (v: unknown) =>
  JSON.stringify(v, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
const hash = (v: unknown) =>
  createHash('sha256').update(canonical(v)).digest('hex');
type Row = RepositoryRecord;
type Request = z.infer<typeof sourceRequest>;
type Mutation = z.infer<typeof sourceDecision>;
export class MaterialSourceService implements DemandSourceHooks {
  private fileReader?: (
    c: DatabaseConnection,
    kind: SourceKind,
    id: string,
    lineId: string,
  ) => Promise<string[]>;
  attachFileReader(reader: NonNullable<MaterialSourceService['fileReader']>) {
    this.fileReader = reader;
  }
  private readonly operationAccess = new AsyncLocalStorage<{
    sourceId: string;
    handlerId: string;
    access: SourceAccess;
    governance: MaterialPolicies;
  }>();
  private readonly ports = new Map<SourceKind, DemandSourcePort>();
  constructor(
    private readonly db: DatabaseManager,
    private readonly runtime: LifecycleRuntime,
    private readonly materials: MaterialService,
    private readonly selections: SupplyChainMaterialService,
    private readonly handlerAccess: (
      c: DatabaseConnection | undefined,
      kind: SourceKind,
      actorId: string,
    ) => Promise<SourceAccess>,
    private readonly governanceAccess: (
      actorId: string,
      action: 'read' | 'resolve',
    ) => Promise<MaterialPolicies>,
    private readonly activeHandler: (
      c: DatabaseConnection,
      id: string,
    ) => Promise<boolean>,
    private readonly actorName: (
      c: DatabaseConnection,
      id: string,
    ) => Promise<string | null>,
  ) {}
  // Authorization owns a request-scoped store, not the business transaction.
  // Resolve fresh grants before opening the transaction (SQLite has one writer
  // connection), then recheck the concrete handler and source under the locks.
  // This context never persists and cannot authorize a different source/handler.
  async runTask<T>(
    taskId: string,
    actor: LifecycleActor,
    run: () => Promise<T>,
  ): Promise<T> {
    const source = await this.db
      .repository('materialRequestSources')
      .findOne({ filter: { requestId: taskId } });
    if (!source) return run();
    const handlerId = text(source.sourceHandlerId);
    const access = await this.handlerAccess(
      undefined,
      source.sourceKind as SourceKind,
      handlerId,
    );
    const governance = await this.governanceAccess(actor.id, 'resolve');
    return this.operationAccess.run(
      { sourceId: text(source.id), handlerId, access, governance },
      run,
    );
  }
  register(port: DemandSourcePort) {
    this.ports.set(port.kind, port);
  }
  private port(kind: SourceKind) {
    const port = this.ports.get(kind);
    if (!port) return fail('SUPPLY_SOURCE_UNAVAILABLE');
    return port;
  }
  private repo(c: DatabaseConnection, p: MaterialPolicies) {
    if (!p.materialRequestSources || p.materialRequestSources.read === false)
      return fail('SUPPLY_FORBIDDEN', 'PERMISSION_DENIED');
    return c
      .repository('materialRequestSources')
      .withPolicy(p.materialRequestSources);
  }
  private async lock(c: DatabaseConnection) {
    for (const [table, id] of [
      ['orgMutationLock', 'organization'],
      ['supplyChainMutationLock', 'supplyChain'],
      ['materialMutationLock', 'materials'],
    ])
      await c
        .repository(table)
        .updateOne({ filter: { id }, values: { nonce: randomUUID() } });
  }
  private view(row: Row): JsonObject {
    return json(
      Object.fromEntries(sourceColumns.map((key) => [key, row[key]])),
    );
  }
  private async display(c: DatabaseConnection, row: Row) {
    return {
      ...this.view(row),
      display: {
        handler: await this.actorName(c, text(row.sourceHandlerId)),
        requester: await this.actorName(c, text(row.requestedBy)),
      },
    };
  }
  private async line(
    c: DatabaseConnection,
    port: DemandSourcePort,
    head: Row,
    id: string,
    access: SourceAccess,
  ) {
    const p = access.policies[port.lineTable];
    if (!p || p.read === false)
      return fail('SUPPLY_FORBIDDEN', 'PERMISSION_DENIED');
    const line = await c
      .repository(port.lineTable)
      .withPolicy(p)
      .findOne({
        filter: {
          id,
          requestId: text(head.id),
          subjectId: text(head.subjectId),
        },
      });
    if (!line) return fail('SUPPLY_SOURCE_NOT_FOUND', 'NOT_FOUND');
    return line;
  }
  private expect(
    head: Row,
    line: Row,
    input: Pick<
      Mutation,
      'version' | 'lifecycleVersion' | 'lineVersion' | 'inputRevision'
    >,
  ) {
    if (
      head.revision !== input.version ||
      head.lifecycleVersion !== input.lifecycleVersion ||
      line.revision !== input.lineVersion ||
      line.inputRevision !== input.inputRevision
    )
      return fail('SUPPLY_SOURCE_VERSION_CONFLICT', 'ABORTED');
    if (head.status === 'cancelled' || line.status !== 'active')
      return fail('SUPPLY_SOURCE_STALE');
  }
  private current(source: Row, head: Row, line: Row) {
    if (
      head.status === 'cancelled' ||
      line.status !== 'active' ||
      line.activeSourceLinkId !== source.id ||
      source.sourceDocumentId !== head.id ||
      (source.purchaseRequestLineId || source.materialIssueRequestLineId) !==
        line.id ||
      head.subjectId !== source.subjectId ||
      line.subjectId !== source.subjectId ||
      Number(head.governanceEpoch) !== Number(source.sourceEpoch) ||
      Number(line.inputRevision) !== Number(source.sourceInputRevision) ||
      Number(line.governanceAttempt) !== Number(source.sourceAttempt) ||
      source.status === 'invalidated'
    )
      return fail('SUPPLY_SOURCE_STALE');
  }
  private async progress(
    c: DatabaseConnection,
    port: DemandSourcePort,
    head: Row,
    actor: LifecycleActor,
    access: SourceAccess,
    reason: string,
    key: string,
    confirmed = false,
    auditActor?: LifecycleActor,
  ) {
    const lines = await c.repository(port.lineTable).findMany({
      filter: { requestId: text(head.id), status: 'active' },
      limit: 101,
    });
    const identified = lines.filter(
      (line) => line.identificationStatus === 'identified',
    ).length;
    const updates: JsonObject = {
      lineCount: lines.length,
      identifiedCount: identified,
      identificationStatus:
        lines.length > 0 && identified === lines.length
          ? 'identified'
          : 'unidentified',
    };
    await port.mutate(c, text(head.id), actor, access, {
      updates,
      confirmed,
      reason,
      requestKey: key,
      auditActor,
    });
  }
  private async lineWrite(
    c: DatabaseConnection,
    port: DemandSourcePort,
    line: Row,
    values: Row,
    access: SourceAccess,
  ) {
    const p = access.policies[port.lineTable];
    if (!p?.update) return fail('SUPPLY_FORBIDDEN', 'PERMISSION_DENIED');
    const result = await c
      .repository(port.lineTable)
      .withPolicy(p)
      .updateOne({
        filter: { id: text(line.id), revision: Number(line.revision) },
        values,
      });
    if (!result.record)
      return fail('SUPPLY_SOURCE_VERSION_CONFLICT', 'ABORTED');
  }
  private async mutate(
    kind: SourceKind,
    id: string,
    lineId: string,
    input: Request | Mutation | z.infer<typeof sourceConfirm>,
    actor: LifecycleActor,
    access: SourceAccess,
    operation: string,
    run: (
      c: DatabaseConnection,
      port: DemandSourcePort,
      head: Row,
      line: Row,
    ) => Promise<Row>,
  ) {
    return this.db.transaction(async (c) => {
      await this.lock(c);
      const port = this.port(kind);
      const head = await port.authorized(c, id, actor, access),
        line = await this.line(c, port, head, lineId, access);
      // Check the current action's mutation scope before returning even a replay.
      for (const [table, row, values] of [
        [port.headTable, head, { updatedBy: actor.id }],
        [port.lineTable, line, { revision: line.revision }],
      ] as const) {
        const p = access.policies[table];
        if (!p?.update) return fail('SUPPLY_FORBIDDEN', 'PERMISSION_DENIED');
        const validation = await c
          .repository(table)
          .withPolicy(p)
          .validateMutation({
            operation: 'updateOne',
            filter: { id: text(row.id) },
            values,
          });
        if (!validation.valid)
          return fail('SUPPLY_FORBIDDEN', 'PERMISSION_DENIED');
        if (
          p.update !== true &&
          !(await c
            .repository(table)
            .withPolicy({
              ...p,
              read: { scope: p.update.scope, fields: ['id'] },
            })
            .exists({ filter: { id: text(row.id) } }))
        )
          return fail('SUPPLY_FORBIDDEN', 'PERMISSION_DENIED');
      }
      const replayId = hash([actor.id, input.requestKey]),
        fingerprint = hash([operation, kind, id, lineId, input]);
      const replay = await c
        .repository('supplyChainActionRequests')
        .findOne({ filter: { id: replayId } });
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          return fail('SUPPLY_REQUEST_CONFLICT', 'ABORTED');
        const result = await this.repo(c, access.policies).findOne({
          filter: {
            id: text((replay.response as JsonObject).sourceId),
            sourceDocumentId: id,
          },
        });
        if (!result) return fail('SUPPLY_SOURCE_NOT_FOUND', 'NOT_FOUND');
        return this.view(result);
      }
      this.expect(head, line, input);
      const source = await run(c, port, head, line);
      await c.repository('supplyChainActionRequests').createOne({
        values: {
          id: replayId,
          actorId: actor.id,
          requestKey: input.requestKey,
          fingerprint,
          resultId: id,
          response: { sourceId: source.id },
          createdAt: new Date(),
        },
      });
      return this.view(source);
    });
  }
  async request(
    kind: SourceKind,
    id: string,
    lineId: string,
    raw: Request,
    actor: LifecycleActor,
    access: SourceAccess,
  ) {
    const input = sourceRequest.parse(raw);
    return this.mutate(
      kind,
      id,
      lineId,
      input,
      actor,
      access,
      'requestGovernance',
      async (c, port, head, line) => {
        return this.createSource(c, port, head, line, input, actor, access);
      },
    );
  }
  private async createSource(
    c: DatabaseConnection,
    port: DemandSourcePort,
    head: Row,
    line: Row,
    input: Request,
    actor: LifecycleActor,
    access: SourceAccess,
    updateHead = true,
  ): Promise<Row> {
    const kind = port.kind,
      id = text(head.id),
      lineId = text(line.id);
    if (
      line.skuId ||
      ![
        'unidentified',
        'governing',
        'needsInformation',
        'awaitingConfirmation',
      ].includes(text(line.identificationStatus))
    )
      return fail('SUPPLY_SOURCE_ALREADY_IDENTIFIED');
    const existing = line.activeSourceLinkId
      ? await this.repo(c, access.policies).findOne({
          filter: { id: text(line.activeSourceLinkId) },
        })
      : null;
    if (existing && ['pending', 'offered'].includes(text(existing.status))) {
      this.current(existing, head, line);
      if (input.retry) return fail('SUPPLY_SOURCE_ACTIVE');
      return existing;
    }
    if (Number(line.governanceAttempt) > 0 && !input.retry)
      return fail('SUPPLY_SOURCE_RETRY_REQUIRED');
    if (input.retry && (!existing || existing.revision !== input.sourceVersion))
      return fail('SUPPLY_SOURCE_VERSION_CONFLICT', 'ABORTED');
    if (existing && existing.status !== 'invalidated') {
      await this.invalidate(c, kind, id, actor, input.reason, [lineId]);
      line = await this.line(c, port, head, lineId, access);
    }
    const attempt = Number(line.governanceAttempt) + 1,
      sourceId = randomUUID();
    // Source action explicitly grants this narrow task operation; it does not grant material maintenance endpoints.
    const taskPolicy = access.policies.materialRequests;
    if (!taskPolicy?.create || !taskPolicy.update)
      return fail('SUPPLY_FORBIDDEN', 'PERMISSION_DENIED');
    const taskResult = await this.materials.saveInTransaction(
      c,
      'requests',
      {
        name: text(line.originalName),
        subjectId: text(head.subjectId),
        specification: text(line.originalSpecification),
        proposedUnit: text(line.requestedUnitText),
        usage: text(line.usage) || text(head.usage),
        notes: '',
        reason: input.reason,
      },
      actor,
      access.policies,
    );
    const task = z
      .object({ id: z.string().uuid(), lifecycleVersion: z.number().int() })
      .parse(taskResult);
    const source = (
      await this.repo(c, access.policies).createOne({
        values: {
          id: sourceId,
          requestId: task.id,
          sourceKind: kind,
          purchaseRequestLineId: kind === 'purchaseRequestLine' ? lineId : null,
          materialIssueRequestLineId:
            kind === 'materialIssueRequestLine' ? lineId : null,
          sourceDocumentId: id,
          subjectId: head.subjectId,
          sourceInputRevision: line.inputRevision,
          sourceEpoch: head.governanceEpoch,
          sourceAttempt: attempt,
          revision: 1,
          status: 'pending',
          proposedSkuId: null,
          offeredAt: null,
          inputSnapshot: {
            attachments: (await this.fileReader?.(c, kind, id, lineId)) ?? [],
            documentCode: head.code,
            lineNo: line.lineNo,
            originalName: line.originalName,
            originalSpecification: line.originalSpecification,
            quantity: line.requestedQuantity,
            requestedUnitText: line.requestedUnitText,
            usage: text(line.usage) || text(head.usage),
            purpose: head.purposeSnapshot ?? null,
          },
          resolutionSnapshot: null,
          requestedBy: actor.id,
          sourceHandlerId: actor.id,
          reason: input.reason,
          invalidatedReason: '',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).record;
    await this.lineWrite(
      c,
      port,
      line,
      {
        activeSourceLinkId: source.id,
        governanceAttempt: attempt,
        identificationStatus: 'governing',
        revision: Number(line.revision) + 1,
      },
      access,
    );
    // Submit before the source becomes observable; failure rolls back task + source + line.
    await this.materials.fireInTransaction(
      c,
      'requests',
      text(task.id),
      'submit',
      {
        version: Number(task.lifecycleVersion),
        requestKey: randomUUID(),
        reason: input.reason,
      },
      actor,
      access.policies,
    );
    if (updateHead)
      await this.progress(
        c,
        port,
        head,
        actor,
        access,
        input.reason,
        input.requestKey,
      );
    await this.audit(c, source, actor, 'requestGovernance', input.reason);
    return source;
  }
  async checkSubmission(
    c: DatabaseConnection,
    kind: SourceKind,
    id: string,
    actor: LifecycleActor,
    access: SourceAccess | undefined,
  ) {
    const port = this.port(kind);
    const unknown = await c
      .repository(port.lineTable)
      .exists({ filter: { requestId: id, status: 'active', skuId: null } });
    if (!unknown) return;
    if (!access)
      return fail('SUPPLY_SOURCE_PERMISSION_REQUIRED', 'PERMISSION_DENIED');
    await port.authorized(c, id, actor, access);
    for (const table of ['materialRequestSources', 'materialRequests']) {
      const policy = access.policies[table];
      if (!policy || policy.read === false || !policy.create || !policy.update)
        return fail('SUPPLY_SOURCE_PERMISSION_REQUIRED', 'PERMISSION_DENIED');
    }
  }
  async submit(
    c: DatabaseConnection,
    kind: SourceKind,
    id: string,
    actor: LifecycleActor,
    access: SourceAccess | undefined,
    reason: string,
  ) {
    const port = this.port(kind),
      lines = await c
        .repository(port.lineTable)
        .findMany({ filter: { requestId: id, status: 'active' }, limit: 101 });
    const unknown = lines.filter((line) => !line.skuId);
    if (!unknown.length) return;
    if (!access)
      return fail('SUPPLY_SOURCE_PERMISSION_REQUIRED', 'PERMISSION_DENIED');
    const head = await port.authorized(c, id, actor, access);
    for (const line of unknown) {
      const existing = line.activeSourceLinkId
        ? await this.repo(c, access.policies).findOne({
            filter: { id: text(line.activeSourceLinkId) },
          })
        : undefined;
      await this.createSource(
        c,
        port,
        head,
        line,
        {
          version: Number(head.revision),
          lifecycleVersion: Number(head.lifecycleVersion),
          lineVersion: Number(line.revision),
          inputRevision: Number(line.inputRevision),
          requestKey: randomUUID(),
          reason,
          retry:
            !!existing &&
            !['pending', 'offered'].includes(text(existing.status)),
          sourceVersion: existing ? Number(existing.revision) : undefined,
        },
        actor,
        access,
        false,
      );
    }
  }
  async confirm(
    kind: SourceKind,
    id: string,
    lineId: string,
    raw: z.infer<typeof sourceConfirm>,
    actor: LifecycleActor,
    access: SourceAccess,
  ) {
    const input = sourceConfirm.parse(raw);
    return this.mutate(
      kind,
      id,
      lineId,
      input,
      actor,
      access,
      'confirmMaterial',
      async (c, port, head, line) => {
        const source = await this.repo(c, access.policies).findOne({
          filter: { id: input.sourceId, sourceDocumentId: id },
        });
        if (!source) return fail('SUPPLY_SOURCE_NOT_FOUND', 'NOT_FOUND');
        this.current(source, head, line);
        if (source.revision !== input.sourceVersion)
          return fail('SUPPLY_SOURCE_VERSION_CONFLICT', 'ABORTED');
        if (source.status !== 'offered')
          return fail('SUPPLY_SOURCE_NOT_OFFERED');
        const selectionInput = {
          kind: 'known' as const,
          subjectId: text(head.subjectId),
          skuId: text(source.proposedSkuId),
          unitId: input.unitId,
          ...(input.unitRuleId ? { unitRuleId: input.unitRuleId } : {}),
          quantity: text(line.requestedQuantity),
        };
        const selected = await this.selections.resolveSelectionInTransaction(
          c,
          port.domain,
          selectionInput,
          access.policies,
        );
        if (selected.identificationStatus !== 'identified')
          return fail('SUPPLY_SOURCE_NOT_OFFERED');
        const previous = line.selectionInput as JsonObject;
        await this.lineWrite(
          c,
          port,
          line,
          {
            ...selected,
            requestedUnitId: selected.unitId,
            requestedUnitText: selected.materialSnapshot.unitName,
            selectionInput: { ...previous, selection: selectionInput },
            revision: Number(line.revision) + 1,
            inputRevision: Number(line.inputRevision) + 1,
            confirmedBy: actor.id,
            confirmedAt: new Date(),
          },
          access,
        );
        const result = (
          await this.repo(c, access.policies).updateOne({
            filter: { id: text(source.id), revision: input.sourceVersion },
            values: {
              status: 'applied',
              revision: Number(source.revision) + 1,
              reason: input.reason,
              updatedAt: new Date(),
            },
          })
        ).record;
        await this.progress(
          c,
          port,
          head,
          actor,
          access,
          input.reason,
          input.requestKey,
          true,
        );
        await this.audit(c, result, actor, 'confirmMaterial', input.reason);
        return result;
      },
    );
  }
  async decide(
    kind: SourceKind,
    id: string,
    lineId: string,
    raw: Mutation,
    actor: LifecycleActor,
    access: SourceAccess,
    takeover = false,
  ) {
    const input = sourceDecision.parse(raw);
    return this.mutate(
      kind,
      id,
      lineId,
      input,
      actor,
      access,
      takeover ? 'takeOverSource' : 'rejectMaterial',
      async (c, port, head, line) => {
        const source = await this.repo(c, access.policies).findOne({
          filter: { id: input.sourceId, sourceDocumentId: id },
        });
        if (!source) return fail('SUPPLY_SOURCE_NOT_FOUND', 'NOT_FOUND');
        this.current(source, head, line);
        if (source.revision !== input.sourceVersion)
          return fail('SUPPLY_SOURCE_VERSION_CONFLICT', 'ABORTED');
        if (!takeover && source.status !== 'offered')
          return fail('SUPPLY_SOURCE_NOT_OFFERED');
        if (takeover) {
          if (source.sourceHandlerId === actor.id)
            return fail('SUPPLY_SOURCE_SAME_HANDLER');
          await this.repo(c, access.policies).updateOne({
            filter: { id: text(source.id) },
            values: {
              sourceHandlerId: actor.id,
              revision: Number(source.revision) + 1,
              reason: input.reason,
              updatedAt: new Date(),
            },
          });
          await this.progress(
            c,
            port,
            head,
            actor,
            access,
            input.reason,
            input.requestKey,
          );
        } else {
          await this.invalidate(c, kind, id, actor, input.reason, [lineId]);
          await this.progress(
            c,
            port,
            head,
            actor,
            access,
            input.reason,
            input.requestKey,
          );
        }
        const result = await this.repo(c, access.policies).findOne({
          filter: { id: text(source.id) },
        });
        if (!result) return fail('SUPPLY_SOURCE_NOT_FOUND', 'NOT_FOUND');
        await this.audit(
          c,
          result,
          actor,
          takeover ? 'takeOverSource' : 'rejectMaterial',
          input.reason,
        );
        return result;
      },
    );
  }
  async list(
    kind: SourceKind,
    id: string,
    _actor: LifecycleActor,
    access: SourceAccess,
  ) {
    const port = this.port(kind),
      c = this.db.connection();
    // Read uses the parent action's current repository policy, not applicant-only eligibility.
    const p = access.policies[port.headTable];
    if (
      !p ||
      !(await c
        .repository(port.headTable)
        .withPolicy(p)
        .exists({ filter: { id } }))
    )
      return fail('SUPPLY_SOURCE_NOT_FOUND', 'NOT_FOUND');
    const policy = access.policies[port.lineTable];
    if (!policy || policy.read === false)
      return fail('SUPPLY_FORBIDDEN', 'PERMISSION_DENIED');
    const lines = await c
      .repository(port.lineTable)
      .withPolicy(policy)
      .findMany({
        filter: { requestId: id, status: 'active' },
        limit: 101,
      });
    if (lines.length > 100) return fail('SUPPLY_SOURCE_TOO_LARGE');
    const ids = lines.flatMap((line) =>
      line.activeSourceLinkId ? [text(line.activeSourceLinkId)] : [],
    );
    if (!ids.length) return [];
    const rows = await this.repo(c, access.policies).findMany({
      filter: (f) =>
        f.and([
          f.string('sourceKind').eq(kind),
          f.string('sourceDocumentId').eq(id),
          f.or(ids.map((value) => f.string('id').eq(value))),
        ]),
      limit: 100,
    });
    return Promise.all(rows.map((row) => this.display(c, row)));
  }
  async history(
    kind: SourceKind,
    id: string,
    lineId: string,
    query: { page: number; pageSize: number },
    access: SourceAccess,
  ) {
    const port = this.port(kind),
      c = this.db.connection(),
      p = access.policies[port.headTable];
    if (
      !p ||
      !(await c
        .repository(port.headTable)
        .withPolicy(p)
        .exists({ filter: { id } }))
    )
      return fail('SUPPLY_SOURCE_NOT_FOUND', 'NOT_FOUND');
    const head = {
      id,
      subjectId: (
        await c
          .repository(port.headTable)
          .withPolicy(p)
          .findOne({ filter: { id } })
      )?.subjectId,
    };
    await this.line(c, port, head, lineId, access);
    const filter = {
      sourceKind: kind,
      sourceDocumentId: id,
      [kind === 'purchaseRequestLine'
        ? 'purchaseRequestLineId'
        : 'materialIssueRequestLineId']: lineId,
    };
    const repo = this.repo(c, access.policies);
    const total = await repo.count({ filter });
    const rows = await repo.findMany({
      filter,
      sort: (s) => [s.field('createdAt').desc(), s.field('id').desc()],
      offset: (query.page - 1) * query.pageSize,
      limit: query.pageSize,
    });
    return {
      data: await Promise.all(rows.map((row) => this.display(c, row))),
      meta: { ...query, total },
    };
  }
  async summary(taskId: string, policies: MaterialPolicies) {
    const c = this.db.connection();
    if (
      !policies.materialRequests ||
      !(await c
        .repository('materialRequests')
        .withPolicy(policies.materialRequests)
        .exists({ filter: { id: taskId } }))
    )
      return fail('SUPPLY_SOURCE_NOT_FOUND', 'NOT_FOUND');
    const source = await this.repo(c, policies).findOne({
      filter: { requestId: taskId },
    });
    return source ? [await this.display(c, source)] : [];
  }
  async afterTask(
    c: DatabaseConnection,
    context: TransitionHookContext<MaterialLifecycleTypes>,
  ) {
    const transition = context.entry.transition;
    const source = await c
      .repository('materialRequestSources')
      .findOne({ filter: { requestId: text(context.record.id) } });
    if (!source || transition === 'invalidateSource') return;
    if (transition === 'submit') {
      if (
        source.status === 'pending' &&
        context.previous.revision === 1 &&
        context.actor.id === source.requestedBy
      )
        return;
      return fail('SUPPLY_SOURCE_RETRY_REQUIRED');
    }
    if (transition.startsWith('edit'))
      return fail('SUPPLY_SOURCE_EDIT_REQUIRED');
    const port = this.port(source.sourceKind as SourceKind),
      head = await c
        .repository(port.headTable)
        .findOne({ filter: { id: text(source.sourceDocumentId) } }),
      line = await c.repository(port.lineTable).findOne({
        filter: {
          id: text(
            source.purchaseRequestLineId || source.materialIssueRequestLineId,
          ),
        },
      });
    if (!head || !line) return fail('SUPPLY_SOURCE_STALE');
    this.current(source, head, line);
    const prepared = this.operationAccess.getStore();
    if (
      !prepared ||
      prepared.sourceId !== source.id ||
      prepared.handlerId !== source.sourceHandlerId
    )
      return fail('SUPPLY_SOURCE_STALE');
    const governance = prepared.governance;
    if (
      !(await this.repo(c, governance).exists({
        filter: { id: text(source.id) },
      }))
    )
      return fail('SUPPLY_FORBIDDEN', 'PERMISSION_DENIED');
    if (!(await this.activeHandler(c, text(source.sourceHandlerId))))
      return fail('SUPPLY_FORBIDDEN', 'PERMISSION_DENIED');
    const access = prepared.access;
    const handler = { id: text(source.sourceHandlerId) };
    await port.authorized(c, text(head.id), handler, access);
    if (transition === 'resolve') {
      if (source.status !== 'pending') return fail('SUPPLY_SOURCE_STALE');
      const detail = await this.selections.detailInTransaction(
        c,
        port.domain,
        text(head.subjectId),
        text(context.record.resolvedSkuId),
        access.policies,
      );
      const sku = z
        .object({
          id: z.string().uuid(),
          code: z.string(),
          name: z.string(),
          baseUnitId: z.string().uuid(),
          version: z.number().int(),
        })
        .parse(detail.data);
      await c.repository('materialRequestSources').updateOne({
        filter: { id: text(source.id), revision: Number(source.revision) },
        values: {
          status: 'offered',
          proposedSkuId: text(context.record.resolvedSkuId),
          offeredAt: new Date(),
          resolutionSnapshot: json({
            skuId: sku.id,
            code: sku.code,
            name: sku.name,
            baseUnitId: sku.baseUnitId,
            version: sku.version,
          }),
          revision: Number(source.revision) + 1,
          updatedAt: new Date(),
        },
      });
      await this.lineWrite(
        c,
        port,
        line,
        {
          identificationStatus: 'awaitingConfirmation',
          revision: Number(line.revision) + 1,
        },
        access,
      );
    } else if (transition === 'return') {
      await c.repository('materialRequestSources').updateOne({
        filter: { id: text(source.id) },
        values: {
          status: 'needsInformation',
          revision: Number(source.revision) + 1,
          reason: text(context.input.reason),
          updatedAt: new Date(),
        },
      });
      await this.lineWrite(
        c,
        port,
        line,
        {
          identificationStatus: 'needsInformation',
          revision: Number(line.revision) + 1,
        },
        access,
      );
    } else if (transition === 'withdraw') {
      await this.invalidate(
        c,
        port.kind,
        text(head.id),
        context.actor,
        text(context.input.reason),
        [text(line.id)],
      );
    } else return;
    // Source handler's scope is enforced, while the actual governance actor remains in both audit trails.
    await this.progress(
      c,
      port,
      head,
      handler,
      access,
      text(context.input.reason),
      `source:${context.entry.id}`,
      false,
      context.actor,
    );
    const after = await c
      .repository('materialRequestSources')
      .findOne({ filter: { id: text(source.id) } });
    await this.audit(
      c,
      after!,
      context.actor,
      transition,
      text(context.input.reason),
    );
  }
  async invalidate(
    c: DatabaseConnection,
    kind: SourceKind,
    documentId: string,
    actor: LifecycleActor,
    reason: string,
    lineIds?: string[],
  ) {
    if (lineIds && !lineIds.length) return;
    const port = this.port(kind),
      sources = await c.repository('materialRequestSources').findMany({
        filter: { sourceKind: kind, sourceDocumentId: documentId },
        limit: 10001,
      });
    if (sources.length > 10000) return fail('SUPPLY_SOURCE_TOO_LARGE');
    for (const source of sources) {
      const lineId = text(
        source.purchaseRequestLineId || source.materialIssueRequestLineId,
      );
      if (
        (lineIds && !lineIds.includes(lineId)) ||
        !['pending', 'needsInformation', 'offered', 'applied'].includes(
          text(source.status),
        )
      )
        continue;
      await c.repository('materialRequestSources').updateOne({
        filter: { id: text(source.id), revision: Number(source.revision) },
        values: {
          status: 'invalidated',
          revision: Number(source.revision) + 1,
          invalidatedReason: reason,
          updatedAt: new Date(),
        },
      });
      const task = await c
        .repository('materialRequests')
        .findOne({ filter: { id: text(source.requestId) } });
      if (task && ['draft', 'pending'].includes(text(task.status)))
        await this.runtime.fire(
          'materialRequests',
          text(task.id),
          'invalidateSource',
          {
            actor,
            manual: false,
            transaction: c,
            expect: { version: Number(task.lifecycleVersion) },
            requestId: randomUUID(),
            input: { reason },
          },
        );
      const line = await c
        .repository(port.lineTable)
        .findOne({ filter: { id: lineId } });
      if (line && line.activeSourceLinkId === source.id)
        await c.repository(port.lineTable).updateOne({
          filter: { id: lineId },
          values: {
            identificationStatus: line.skuId ? 'identified' : 'unidentified',
            revision: Number(line.revision) + 1,
          },
        });
      const invalidated = await c
        .repository('materialRequestSources')
        .findOne({ filter: { id: text(source.id) } });
      await this.audit(c, invalidated!, actor, 'invalidateSource', reason);
    }
  }
  async excludesSkuReviewer(
    c: DatabaseConnection,
    taskId: string,
    actorId: string,
  ) {
    const source = await c
      .repository('materialRequestSources')
      .findOne({ filter: { requestId: taskId } });
    if (!source) return false;
    const port = this.port(source.sourceKind as SourceKind),
      head = await c
        .repository(port.headTable)
        .findOne({ filter: { id: text(source.sourceDocumentId) } });
    if (!head) return true;
    const excluded = [
      source.requestedBy,
      source.sourceHandlerId,
      head.createdBy,
      head.requesterAccountId,
      head.recipientAccountId,
      head.submittedBy,
    ];
    for (const field of ['requesterEmployeeId', 'recipientEmployeeId'])
      if (head[field]) {
        const employee = await c
          .repository('personnelEmployees')
          .findOne({ filter: { id: text(head[field]) } });
        excluded.push(employee?.accountId);
      }
    return excluded.includes(actorId);
  }
  private async audit(
    c: DatabaseConnection,
    source: Row,
    actor: LifecycleActor,
    operation: string,
    reason: string,
  ) {
    await c.repository('supplyChainAudit').createOne({
      values: {
        id: randomUUID(),
        kind: 'materialRequestSources',
        recordId: source.id,
        subjectId: source.subjectId,
        actorId: actor.id,
        operation,
        reason,
        beforeValue: null,
        afterValue: this.view(source),
        createdAt: new Date(),
      },
    });
  }
}

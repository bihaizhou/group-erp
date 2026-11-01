import { lockDemandHeader } from './inventory-db.js';
import { refreshIssueFulfillment } from './inventory-issue-source.js';
import { stockMicros, stockQuantity } from './inventory-quantity.js';
import {
  guardDemandExecution,
  guardIssueReservations,
} from './demand-execution-guards.js';
import type {
  DemandFileHooks,
  FileDemandPort,
} from './supply-chain-file-model.js';
import { SupplyChainError } from './supply-chain-model.js';
import { createHash, randomUUID } from 'node:crypto';
import type {
  DemandSourceHooks,
  DemandSourcePort,
  SourceAccess,
} from './material-source-model.js';
import { ApiError } from '@nocobase/app-server/router';
import type {
  DatabaseConnection,
  DatabaseManager,
  FilterBuilder,
  RepositoryRecord,
} from '@nocobase/db';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import {
  createRepositoryLifecycleStore,
  StoredLifecycleParameters,
  normalizeParameterValues,
  resolveReviewerSelections,
  type JsonObject,
  type LifecycleActor,
  type LifecycleRuntime,
  type ReviewerSelection,
  type TransitionContext,
} from '@nocobase/lifecycle';
import { reviewRuleFields } from './review-rule-fields.js';
import { reviewScope } from './review-scope.js';
import type { MaterialPolicies } from './material-service.js';
import type { IssuePurposeService } from './issue-purpose-service.js';
import type { SupplyChainMaterialService } from './supply-chain-material-service.js';
import { materialIdFilter } from './material-filters.js';
import { businessDate } from './business-date.js';
import {
  issueVersionColumns,
  issueTaskColumns,
  issueCreate,
  issueUpdate,
  issueAction,
  issueSettingsSave,
  issueRules,
  type IssueContent,
  type IssueCreate,
  type IssueUpdate,
  type IssueAction,
  type IssueReceive,
  type IssueQuery,
  type IssuePage,
  type IssueOptionQuery,
  type IssueSettingsSave,
} from './issue-request-model.js';
import {
  issueLifecycle,
  issueParameterCollections,
  issueRuleGroup,
  issueRuleDefaults,
  type IssueWorkflowTypes,
} from './issue-request-workflow.js';

type Row = RepositoryRecord;
export interface IssueAccess {
  policies: MaterialPolicies;
  delegate: MaterialPolicies | null;
  source?: SourceAccess;
}
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const json = (value: unknown): JsonObject =>
  JSON.parse(JSON.stringify(value)) as JsonObject;
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
const hash = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
export function issueError(
  reason: string,
  status: ConstructorParameters<
    typeof ApiError
  >[0]['status'] = 'FAILED_PRECONDITION',
  field?: string,
): never {
  throw new ApiError({
    status,
    domain: 'requisitions',
    reason,
    message: 'The issue request operation could not be completed.',
    ...(field ? { fieldViolations: [{ field, description: reason }] } : {}),
  });
}
const denied = () => issueError('ISSUE_FORBIDDEN', 'PERMISSION_DENIED');
const missing = () => issueError('ISSUE_NOT_FOUND', 'NOT_FOUND');

export class IssueRequestService {
  private fileHooks?: DemandFileHooks;
  attachFiles(hooks: DemandFileHooks): FileDemandPort {
    this.fileHooks = hooks;
    return {
      read: (c, id, access) => this.head(c, id, access.policies),
      edit: async (c, id, actor, access) => {
        const head = await this.head(c, id, access.policies);
        await this.applicant(c, head, actor, access);
        if (head.status !== 'draft') return issueError('ISSUE_NOT_DRAFT');
        await this.assertWrite(
          c,
          'materialIssueRequests',
          { updatedBy: actor.id },
          access.policies,
          'update',
          id,
        );
        return head;
      },
    };
  }
  private sourceHooks?: DemandSourceHooks;
  attachSources(hooks: DemandSourceHooks): DemandSourcePort {
    this.sourceHooks = hooks;
    return {
      kind: 'materialIssueRequestLine',
      domain: 'requisitions',
      headTable: 'materialIssueRequests',
      lineTable: 'materialIssueRequestLines',
      authorized: async (c, id, actor, access) => {
        const head = await this.head(c, id, access.policies);
        await this.applicant(c, head, actor, access);
        return head;
      },
      mutate: (c, id, actor, access, input) =>
        this.sourceMutation(c, id, actor, access, input),
    };
  }
  private async sourceMutation(
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
  ): Promise<JsonObject> {
    const before = await this.head(c, id, access.policies);
    await this.applicant(c, before, actor, access);
    if (before.status === 'cancelled') return issueError('ISSUE_NOT_DRAFT');
    const effectiveActor = input.auditActor ?? actor;
    const updates = { ...input.updates, updatedBy: effectiveActor.id };
    await this.assertWrite(
      c,
      'materialIssueRequests',
      updates,
      access.policies,
      'update',
      id,
    );
    const result = await this.runtime.fire(
      'materialIssueRequests',
      id,
      input.confirmed
        ? 'confirmMaterial'
        : `source${text(before.status).slice(0, 1).toUpperCase()}${text(before.status).slice(1)}`,
      {
        actor: effectiveActor,
        manual: false,
        transaction: c,
        expect: { version: Number(before.lifecycleVersion) },
        requestId: input.requestKey,
        input: { values: json(updates), reason: input.reason },
      },
    );
    await this.assertWrite(
      c,
      'materialIssueRequests',
      this.changes(before, result.record as Row),
      access.policies,
      'update',
      id,
    );
    await this.audit(
      c,
      result.record as Row,
      before,
      effectiveActor,
      input.confirmed ? 'confirmMaterial' : 'sourceProgress',
      input.reason,
    );
    return this.view(c, result.record as Row, access.policies);
  }

  readonly parameters: StoredLifecycleParameters;
  constructor(
    private readonly db: DatabaseManager,
    private readonly runtime: LifecycleRuntime,
    private readonly purposes: IssuePurposeService,
    private readonly materials: SupplyChainMaterialService,
    private readonly users: UserAdministrationService,
    private readonly timeZone: string,
  ) {
    this.parameters = new StoredLifecycleParameters(
      createRepositoryLifecycleStore(db),
      issueParameterCollections,
    );
    runtime.register(issueLifecycle, {
      parameterConfiguration: {
        store: this.parameters,
        scope: ({ record, values }) =>
          reviewScope(
            'requisitions',
            text(record?.subjectId ?? values?.subjectId),
          ),
        legacyRecord: () => false,
        snapshotRequired: (record) => Number(record.reviewRound) > 0,
      },
      services: (handle) => ({
        prepare: (context, operation) =>
          this.prepare(handle as DatabaseConnection, context, operation),
      }),
    });
  }
  private repo(c: DatabaseConnection, table: string, p: MaterialPolicies) {
    if (!p[table] || p[table].read === false) return denied();
    return c.repository(table).withPolicy(p[table]);
  }
  private async lock(c: DatabaseConnection) {
    // Global lock ordering matches the organization, supplier and material services.
    await c.repository('orgMutationLock').updateOne({
      filter: { id: 'organization' },
      values: { nonce: randomUUID() },
    });
    await c.repository('supplyChainMutationLock').updateOne({
      filter: { id: 'supplyChain' },
      values: { nonce: randomUUID() },
    });
  }
  private async company(
    c: DatabaseConnection,
    id: string,
    p: MaterialPolicies,
    active = true,
  ) {
    const row = await this.repo(c, 'orgSubjects', p).findOne({
      filter: { id, ...(active ? { status: 'active' } : {}) },
    });
    if (!row)
      return issueError(
        'ISSUE_COMPANY_UNAVAILABLE',
        'INVALID_ARGUMENT',
        'subjectId',
      );
    return row;
  }
  private async head(c: DatabaseConnection, id: string, p: MaterialPolicies) {
    const row = await this.repo(c, 'materialIssueRequests', p).findOne({
      filter: { id },
    });
    if (!row) return missing();
    await this.company(c, text(row.subjectId), p, false);
    return row;
  }
  private async lines(c: DatabaseConnection, id: string, p?: MaterialPolicies) {
    const rows = await (
      p
        ? this.repo(c, 'materialIssueRequestLines', p)
        : c.repository('materialIssueRequestLines')
    ).findMany({
      filter: { requestId: id },
      sort: (s) => [s.field('lineNo').asc()],
      limit: 10001,
    });
    if (rows.length > 10000) return issueError('ISSUE_HISTORY_TOO_LARGE');
    return rows;
  }
  private async view(c: DatabaseConnection, row: Row, p: MaterialPolicies) {
    const id = text(row.id);
    row = await this.head(c, id, p);
    const [lines, versions, reviewTasks, fulfillments] = await Promise.all([
      this.lines(c, id, p),
      this.repo(c, 'supplyChainRequestVersions', p).findMany({
        filter: { issueRequestId: id, kind: 'materialIssueRequest' },
        sort: (s) => [s.field('contentVersion').desc()],
        limit: 10001,
      }),
      this.repo(c, 'supplyChainReviewTasks', p).findMany({
        filter: { issueRequestId: id, kind: 'materialIssueRequest' },
        sort: (s) => [s.field('round').desc()],
        limit: 10001,
      }),
      c.repository('stockIssueFulfillments').findMany({
        filter: { issueRequestId: id },
        limit: 10001,
      }),
    ]);
    if (versions.length > 10000 || reviewTasks.length > 10000)
      return issueError('ISSUE_HISTORY_TOO_LARGE');
    const recentHistory = await this.repo(c, 'supplyChainAudit', p).findMany({
      filter: { kind: 'materialIssueRequests', recordId: id },
      sort: (s) => [s.field('createdAt').desc(), s.field('id').desc()],
      limit: 1,
    });
    return json({
      ...row,
      attachments:
        (await this.fileHooks?.read(
          c,
          'materialIssueRequest',
          id,
          undefined,
          p,
        )) ?? [],
      lines: lines.map((line) => {
        const fulfillment = fulfillments.find(
          (row) => text(row.id) === text(line.id),
        );
        return {
          ...line,
          issuedQuantity: text(fulfillment?.issuedQuantity ?? '0'),
          returnedQuantity: text(fulfillment?.returnedQuantity ?? '0'),
          receivedQuantity: text(fulfillment?.receivedQuantity ?? '0'),
        };
      }),
      versions: versions.map((row) =>
        Object.fromEntries(
          issueVersionColumns
            .filter((key) => key in row)
            .map((key) => [key, row[key]]),
        ),
      ),
      reviewTasks: reviewTasks.map((row) =>
        Object.fromEntries(
          issueTaskColumns
            .filter((key) => key in row)
            .map((key) => [key, row[key]]),
        ),
      ),
      recentHistory: await Promise.all(
        recentHistory.map(async (audit) => ({
          ...audit,
          actor: await this.accountReference(c, audit.actorId, p),
        })),
      ),
      display: await this.display(c, row, p, true),
    });
  }
  async detail(id: string, p: MaterialPolicies) {
    const c = this.db.connection();
    return this.view(c, await this.head(c, id, p), p);
  }
  async receive(
    id: string,
    input: IssueReceive,
    actor: LifecycleActor,
    p: MaterialPolicies,
  ) {
    return this.db.transaction(async (c) => {
      await lockDemandHeader(c, 'materialIssueRequests', id);
      const before = await this.head(c, id, p);
      if (before.status !== 'approved')
        return issueError('ISSUE_NOT_APPROVED', 'FAILED_PRECONDITION');
      if (text(before.recipientAccountId) !== actor.id)
        return issueError('ISSUE_FORBIDDEN', 'PERMISSION_DENIED');
      if (Number(before.revision) !== input.version)
        return issueError('ISSUE_VERSION_CONFLICT', 'ABORTED');
      const fulfillments = await c
          .repository('stockIssueFulfillments')
          .findMany({ filter: { issueRequestId: id }, limit: 10001 }),
        now = new Date();
      let received = 0;
      for (const row of fulfillments) {
        const available =
          stockMicros(text(row.issuedQuantity)) -
          stockMicros(text(row.returnedQuantity)) -
          stockMicros(text(row.receivedQuantity ?? '0'));
        if (available <= 0n) continue;
        await c.repository('stockIssueFulfillments').updateOne({
          filter: { id: text(row.id), revision: Number(row.revision) },
          values: {
            receivedQuantity: stockQuantity(
              stockMicros(text(row.receivedQuantity ?? '0')) + available,
            ),
            revision: Number(row.revision) + 1,
          },
        });
        received += 1;
      }
      if (!received)
        return issueError('ISSUE_NOTHING_TO_RECEIVE', 'FAILED_PRECONDITION');
      await c.repository('materialIssueRequests').updateOne({
        filter: { id, revision: Number(before.revision) },
        values: {
          receivedBy: actor.id,
          receivedAt: now,
          receiptNote: input.note,
          updatedBy: actor.id,
          updatedAt: now,
          revision: Number(before.revision) + 1,
        },
      });
      await refreshIssueFulfillment(c, id);
      const after = await this.head(c, id, p);
      await this.audit(
        c,
        after,
        before,
        actor,
        'receive',
        input.note || 'Issue request received',
      );
      return this.view(c, after, p);
    });
  }

  async list(query: IssueQuery, actor: LifecycleActor, p: MaterialPolicies) {
    const c = this.db.connection();
    await this.company(c, query.subjectId, p, false);
    const filter = (f: FilterBuilder) =>
      f.and([
        f.string('subjectId').eq(query.subjectId),
        ...(query.status ? [f.string('status').eq(query.status)] : []),
        ...(query.fulfillmentStatus
          ? [f.string('fulfillmentStatus').eq(query.fulfillmentStatus)]
          : []),
        ...(query.mine === 'true'
          ? [
              f.or([
                f.string('createdBy').eq(actor.id),
                f.string('requesterAccountId').eq(actor.id),
                f.string('recipientAccountId').eq(actor.id),
              ]),
            ]
          : []),
        ...(query.q
          ? [
              f.or(
                ['code', 'usage', 'notes'].map((key) =>
                  (key === 'code' ? f.string(key) : f.text(key)).includes(
                    query.q!,
                    { mode: 'insensitive' },
                  ),
                ),
              ),
            ]
          : []),
        ...(query.neededFrom
          ? [f.date('neededOn').notBefore(query.neededFrom)]
          : []),
        ...(query.neededTo
          ? [f.date('neededOn').notAfter(query.neededTo)]
          : []),
        ...(query.identification
          ? [f.string('identificationStatus').eq(query.identification)]
          : []),
      ]);
    const repo = this.repo(c, 'materialIssueRequests', p);
    const [data, total] = await Promise.all([
      repo.findMany({
        filter,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
        sort: (s) => [
          query.orderBy.startsWith('-')
            ? s.field(query.orderBy.slice(1)).desc()
            : s.field(query.orderBy).asc(),
          s.field('id').asc(),
        ],
      }),
      repo.count({ filter }),
    ]);
    return {
      data: await Promise.all(
        data.map(async (row) =>
          json({ ...row, display: await this.display(c, row, p) }),
        ),
      ),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }
  async history(id: string, query: IssuePage, p: MaterialPolicies) {
    const c = this.db.connection();
    await this.head(c, id, p);
    const repo = this.repo(c, 'supplyChainAudit', p),
      filter = { kind: 'materialIssueRequests', recordId: id };
    const [data, total] = await Promise.all([
      repo.findMany({
        filter,
        sort: (s) => [s.field('createdAt').desc(), s.field('id').asc()],
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }),
      repo.count({ filter }),
    ]);
    return {
      data: await Promise.all(
        data.map(async (row) =>
          json({
            ...row,
            actor: await this.accountReference(c, row.actorId, p),
          }),
        ),
      ),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }
  private async reference(
    c: DatabaseConnection,
    table: string,
    id: unknown,
    p: MaterialPolicies,
  ) {
    if (!id || !p[table] || p[table].read === false) return null;
    const row = await this.repo(c, table, p).findOne({
      filter: { id: text(id) },
    });
    return row
      ? {
          id: text(row.id),
          code: text(row.code),
          name: text(row.name),
          availability: row.status === 'active' ? 'active' : 'inactive',
        }
      : null;
  }
  private async accountReference(
    c: DatabaseConnection,
    accountId: unknown,
    p: MaterialPolicies,
  ) {
    if (
      !accountId ||
      !p.personnelEmployees ||
      p.personnelEmployees.read === false
    )
      return null;
    const row = await this.repo(c, 'personnelEmployees', p).findOne({
      filter: { accountId: text(accountId) },
    });
    return row
      ? {
          id: text(accountId),
          code: text(row.code),
          name: text(row.name),
          availability: row.status === 'active' ? 'active' : 'inactive',
        }
      : null;
  }
  private async display(
    c: DatabaseConnection,
    row: Row,
    p: MaterialPolicies,
    detail = false,
  ) {
    const [company, requester, recipient, unit, purpose, creator, submitter] =
      await Promise.all([
        this.reference(c, 'orgSubjects', row.subjectId, p),
        this.reference(c, 'personnelEmployees', row.requesterEmployeeId, p),
        this.reference(c, 'personnelEmployees', row.recipientEmployeeId, p),
        this.reference(c, 'orgUnits', row.requestingUnitId, p),
        this.reference(c, 'materialIssuePurposes', row.purposeId, p),
        this.accountReference(c, row.createdBy, p),
        this.accountReference(c, row.submittedBy, p),
      ]);
    const relatedRequests: { id: string; code: string; relation: string }[] =
      [];
    const accounts: Record<string, unknown> = {};
    if (detail) {
      const related = await this.repo(c, 'materialIssueRequests', p).findMany({
        filter: (f) =>
          f.or([
            f.string('supersedesId').eq(text(row.id)),
            ...(row.supersedesId
              ? [f.string('id').eq(text(row.supersedesId))]
              : []),
          ]),
        limit: 10001,
      });
      if (related.length > 10000) return issueError('ISSUE_HISTORY_TOO_LARGE');
      for (const item of related) {
        // Both ends must be readable under the caller's company and record policies.
        try {
          await this.head(c, text(item.id), p);
        } catch (error) {
          if (error instanceof ApiError) continue;
          throw error;
        }
        relatedRequests.push({
          id: text(item.id),
          code: text(item.code),
          relation: item.id === row.supersedesId ? 'source' : 'copy',
        });
      }
      const tasks = await this.repo(c, 'supplyChainReviewTasks', p).findMany({
        filter: { issueRequestId: text(row.id), kind: 'materialIssueRequest' },
        limit: 10001,
      });
      if (tasks.length > 10000) return issueError('ISSUE_HISTORY_TOO_LARGE');
      const ids = new Set(
        tasks
          .flatMap((task) => [
            ...(task.candidates as string[]),
            text(task.decidedBy),
          ])
          .filter(Boolean),
      );
      for (const id of ids)
        accounts[id] = await this.accountReference(c, id, p);
    }
    return {
      company,
      requester,
      recipient,
      unit,
      purpose,
      creator,
      submitter,
      relatedRequests,
      accounts,
    };
  }

  private async assertWrite(
    c: DatabaseConnection,
    table: string,
    values: Row,
    p: MaterialPolicies,
    operation: 'create' | 'update',
    id?: string,
  ) {
    const policy = p[table];
    if (!policy || policy.read === false || !policy[operation]) return denied();
    const result = await c
      .repository(table)
      .withPolicy(policy)
      .validateMutation(
        operation === 'create'
          ? { operation: 'createOne', values }
          : { operation: 'updateOne', filter: { id }, values },
      );
    if (!result.valid) return denied();
    const node = policy[operation];
    if (
      id &&
      node !== true &&
      !(await c
        .repository(table)
        .withPolicy({ ...policy, read: { scope: node.scope, fields: ['id'] } })
        .exists({ filter: { id } }))
    )
      return denied();
  }
  private changes(before: Row, after: Row): Row {
    return Object.fromEntries(
      Object.entries(after).filter(
        ([key, value]) => canonical(value) !== canonical(before[key]),
      ),
    );
  }
  private async audit(
    c: DatabaseConnection,
    row: Row,
    before: Row | null,
    actor: LifecycleActor,
    operation: string,
    reason: string,
  ) {
    await c.repository('supplyChainAudit').createOne({
      values: {
        id: randomUUID(),
        kind: 'materialIssueRequests',
        recordId: row.id,
        subjectId: row.subjectId,
        actorId: actor.id,
        operation,
        reason,
        beforeValue: before ? json(before) : null,
        afterValue: json(row),
        createdAt: new Date(),
      },
    });
  }
  private async replayRead(
    c: DatabaseConnection,
    response: JsonObject,
    p: MaterialPolicies,
  ) {
    const check = async (table: string, row: JsonObject) => {
      const policy = p[table];
      if (!policy || policy.read === false) return denied();
      const fields = policy.read === true ? undefined : policy.read.fields;
      if (
        fields === false ||
        (fields && Object.keys(row).some((key) => !fields.includes(key)))
      )
        return denied();
      if (
        !(await this.repo(c, table, p).exists({ filter: { id: text(row.id) } }))
      )
        return missing();
    };
    const {
      lines,
      versions,
      reviewTasks,
      display: _display,
      recentHistory,
      attachments,
      ...head
    } = response;
    await check('materialIssueRequests', head);
    const safeLines = ((lines ?? []) as JsonObject[]).map((line) => {
      const copy = { ...line };
      delete copy.issuedQuantity;
      delete copy.returnedQuantity;
      delete copy.receivedQuantity;
      return copy;
    });
    await this.fileHooks?.assertReadable(
      c,
      'materialIssueRequest',
      text(head.id),
      attachments,
      p,
    );
    for (const audit of (recentHistory ?? []) as JsonObject[]) {
      const { actor: _actor, ...stored } = audit;
      await check('supplyChainAudit', stored);
    }
    for (const [table, rows] of [
      ['materialIssueRequestLines', safeLines],
      ['supplyChainRequestVersions', versions],
      ['supplyChainReviewTasks', reviewTasks],
    ] as const)
      for (const row of rows as JsonObject[]) await check(table, row);
  }
  private async action(
    operation: string,
    input: { requestKey: string },
    actor: LifecycleActor,
    access: IssueAccess,
    run: (c: DatabaseConnection) => Promise<JsonObject>,
    replayWrite: 'create' | 'update' = 'update',
  ) {
    return this.db.transaction(async (c) => {
      await this.lock(c);
      const id = hash([actor.id, input.requestKey]),
        fingerprint = hash([operation, input]);
      const replay = await c
        .repository('supplyChainActionRequests')
        .findOne({ filter: { id } });
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          return issueError('ISSUE_REQUEST_CONFLICT', 'ABORTED');
        const row = await this.head(c, text(replay.resultId), access.policies);
        const saved = replay.response as {
          data: JsonObject;
          headWrite: Row;
          lineWrites: {
            operation: 'create' | 'update';
            id: string;
            values: Row;
          }[];
        };
        await this.assertWrite(
          c,
          'materialIssueRequests',
          saved.headWrite,
          access.policies,
          replayWrite,
          text(row.id),
        );
        // A saved delegate permission is never sufficient after it is revoked.
        if (
          !('transition' in input) ||
          !['approve', 'return', 'reassign'].includes(String(input.transition))
        )
          await this.applicant(c, row, actor, access);
        if (replay.fingerprint !== fingerprint)
          return issueError('ISSUE_REQUEST_CONFLICT', 'ABORTED');
        for (const write of saved.lineWrites)
          await this.assertWrite(
            c,
            'materialIssueRequestLines',
            write.values,
            access.policies,
            write.operation,
            write.id,
          );
        if ('transition' in input && input.transition === 'submit')
          await this.sourceHooks?.checkSubmission(
            c,
            'materialIssueRequestLine',
            text(row.id),
            actor,
            access.source,
          );
        await this.replayRead(c, saved.data, access.policies);
        return json({
          ...saved.data,
          display: await this.display(c, saved.data, access.policies, true),
          recentHistory: await Promise.all(
            ((saved.data.recentHistory ?? []) as JsonObject[]).map(
              async (audit) => ({
                ...audit,
                actor: await this.accountReference(
                  c,
                  audit.actorId,
                  access.policies,
                ),
              }),
            ),
          ),
        });
      }
      const trackedId = operation.split(':')[1];
      const previous = trackedId
        ? await c
            .repository('materialIssueRequests')
            .findOne({ filter: { id: trackedId } })
        : undefined;
      const previousLines = trackedId ? await this.lines(c, trackedId) : [];
      const response = await run(c);
      const after = await c
        .repository('materialIssueRequests')
        .findOne({ filter: { id: text(response.id) } });
      const headWrite =
        previous?.id === after?.id ? this.changes(previous!, after!) : after!;
      const lineWrites = (await this.lines(c, text(response.id))).flatMap(
        (line) => {
          const old =
            previous?.id === after?.id
              ? previousLines.find((item) => item.id === line.id)
              : undefined;
          const values = old ? this.changes(old, line) : line;
          return Object.keys(values).length
            ? [
                {
                  operation: old ? 'update' : 'create',
                  id: text(line.id),
                  values,
                },
              ]
            : [];
        },
      );
      await c.repository('supplyChainActionRequests').createOne({
        values: {
          id,
          actorId: actor.id,
          requestKey: input.requestKey,
          fingerprint,
          resultId: response.id,
          response: json({ data: response, headWrite, lineWrites }),
          createdAt: new Date(),
        },
      });
      return response;
    });
  }
  /** Targeted internal warehouse check; it does not expose or grant HR records. */
  async assertExecutionPeople(c: DatabaseConnection, head: Row) {
    if (head.status !== 'approved' || !head.approvedVersionId)
      return issueError('ISSUE_NOT_APPROVED', 'FAILED_PRECONDITION');
    for (const field of ['requesterEmployeeId', 'recipientEmployeeId']) {
      const person = await this.activeEmployee(
        c,
        text(head[field]),
        text(head.subjectId),
        undefined,
        field,
      );
      if (person.accountId) {
        const user = await this.users
          .withConnection(c)
          .get(text(person.accountId));
        if (!user || user.kind !== 'person' || user.disabledAt)
          return issueError(
            'ISSUE_PERSON_UNAVAILABLE',
            'FAILED_PRECONDITION',
            field,
          );
      }
    }
  }
  private async activeEmployee(
    c: DatabaseConnection,
    personId: string,
    subjectId: string,
    p?: MaterialPolicies,
    field = 'requesterEmployeeId',
  ) {
    const repo = (table: string) =>
      p ? this.repo(c, table, p) : c.repository(table);
    const person = await repo('personnelEmployees').findOne({
      filter: { id: personId, status: 'active' },
    });
    if (!person)
      return issueError('ISSUE_PERSON_UNAVAILABLE', 'INVALID_ARGUMENT', field);
    const employments = await repo('personnelEmployments').findMany({
      filter: { personId, subjectId, status: 'active' },
      limit: 10001,
    });
    const today = businessDate(this.timeZone);
    if (
      employments.length > 10000 ||
      !employments.some((r) => this.effective(r, today))
    )
      return issueError('ISSUE_PERSON_UNAVAILABLE', 'INVALID_ARGUMENT', field);
    return person;
  }
  private effective(row: Row, today: string) {
    const d = row.data as { startDate?: string; endDate?: string | null };
    return (
      typeof d.startDate === 'string' &&
      d.startDate <= today &&
      (!d.endDate || d.endDate > today)
    );
  }
  private async positionsFor(
    c: DatabaseConnection,
    personId: string,
    subjectId: string,
  ) {
    const rows = await c.repository('personnelAssignments').findMany({
      filter: { personId, subjectId, status: 'active' },
      limit: 10001,
    });
    if (rows.length > 10000) return issueError('ISSUE_REFERENCE_TOO_BROAD');
    const valid: Row[] = [];
    for (const row of rows) {
      if (!this.effective(row, businessDate(this.timeZone))) continue;
      const position = await c
        .repository('orgPositions')
        .findOne({ filter: { id: text(row.positionId), status: 'active' } });
      const unit =
        position &&
        (await c.repository('orgUnits').findOne({
          filter: { id: text(position.unitId), subjectId, status: 'active' },
        }));
      if (position && unit) valid.push({ ...position, unitId: unit.id });
    }
    return valid;
  }
  private async canDelegate(
    c: DatabaseConnection,
    subjectId: string,
    access: IssueAccess,
  ) {
    const policy = access.delegate?.orgSubjects;
    return (
      !!policy &&
      policy.read !== false &&
      (await c
        .repository('orgSubjects')
        .withPolicy(policy)
        .exists({ filter: { id: subjectId } }))
    );
  }
  private async applicant(
    c: DatabaseConnection,
    row: Row,
    actor: LifecycleActor,
    access: IssueAccess,
  ) {
    if (!row.requesterEmployeeId) {
      if (
        row.createdBy !== actor.id &&
        !(await this.canDelegate(c, text(row.subjectId), access))
      )
        return denied();
      return;
    }
    const person = await this.repo(
      c,
      'personnelEmployees',
      access.policies,
    ).findOne({ filter: { id: text(row.requesterEmployeeId) } });
    if (
      person?.accountId !== actor.id &&
      !(await this.canDelegate(c, text(row.subjectId), access))
    )
      return issueError('ISSUE_DELEGATE_REQUIRED', 'PERMISSION_DENIED');
  }
  private async contentValues(
    c: DatabaseConnection,
    content: IssueContent,
    actor: LifecycleActor,
    access: IssueAccess,
    formal = false,
    readOnly = false,
  ) {
    const p = access.policies;
    await this.company(c, content.subjectId, p);
    let requesterAccountId: string | null = null;
    if (content.requesterEmployeeId) {
      const person = await this.activeEmployee(
        c,
        content.requesterEmployeeId,
        content.subjectId,
        p,
      );
      requesterAccountId = text(person.accountId) || null;
      if (
        requesterAccountId !== actor.id &&
        !(await this.canDelegate(c, content.subjectId, access))
      )
        return issueError('ISSUE_DELEGATE_REQUIRED', 'PERMISSION_DENIED');
    }
    if (
      content.requestingUnitId &&
      !(await this.repo(c, 'orgUnits', p).exists({
        filter: {
          id: content.requestingUnitId,
          subjectId: content.subjectId,
          status: 'active',
        },
      }))
    )
      return issueError(
        'ISSUE_UNIT_UNAVAILABLE',
        'INVALID_ARGUMENT',
        'requestingUnitId',
      );
    if (
      content.requesterEmployeeId &&
      content.requestingUnitId &&
      !(
        await this.positionsFor(
          c,
          content.requesterEmployeeId,
          content.subjectId,
        )
      ).some((r) => r.unitId === content.requestingUnitId)
    )
      return issueError(
        'ISSUE_PERSON_UNIT_MISMATCH',
        'INVALID_ARGUMENT',
        'requestingUnitId',
      );
    if (formal)
      for (const key of [
        'requesterEmployeeId',
        'requestingUnitId',
        'recipientEmployeeId',
        'purposeId',
        'usage',
        'neededOn',
      ] as const)
        if (!content[key])
          return issueError('ISSUE_REQUIRED', 'INVALID_ARGUMENT', key);
    if (formal && content.lines.length === 0)
      return issueError('ISSUE_LINES_REQUIRED', 'INVALID_ARGUMENT', 'lines');
    let recipientAccountId: string | null = null;
    if (content.recipientEmployeeId) {
      const recipient = await this.activeEmployee(
        c,
        content.recipientEmployeeId,
        content.subjectId,
        p,
        'recipientEmployeeId',
      );
      recipientAccountId = text(recipient.accountId) || null;
      if (
        (
          await this.positionsFor(
            c,
            content.recipientEmployeeId,
            content.subjectId,
          )
        ).length === 0
      )
        return issueError(
          'ISSUE_RECIPIENT_UNAVAILABLE',
          'INVALID_ARGUMENT',
          'recipientEmployeeId',
        );
      if (
        recipientAccountId !== actor.id &&
        !(await this.canDelegate(c, content.subjectId, access))
      )
        return issueError(
          'ISSUE_RECIPIENT_DELEGATE_REQUIRED',
          'PERMISSION_DENIED',
          'recipientEmployeeId',
        );
    }
    const purposeSnapshot = content.purposeId
      ? await (
          readOnly
            ? this.purposes.previewPurposeInTransaction.bind(this.purposes)
            : this.purposes.resolvePurposeInTransaction.bind(this.purposes)
        )(c, content.subjectId, content.purposeId, p)
      : null;
    const {
      lines: _lines,
      projectId: _projectId,
      attachments: _attachments,
      ...head
    } = content;
    return {
      ...head,
      requesterAccountId,
      recipientAccountId,
      purposeSnapshot: purposeSnapshot ? json(purposeSnapshot) : null,
    };
  }
  private async saveLines(
    c: DatabaseConnection,
    requestId: string,
    content: IssueContent,
    actor: LifecycleActor,
    p: MaterialPolicies,
    previousHead?: Row,
  ) {
    const old = await this.lines(c, requestId);
    // A restrictive line policy must not turn an unseen line into a deletion.
    for (const line of old)
      if (
        !(await this.repo(c, 'materialIssueRequestLines', p).exists({
          filter: { id: text(line.id) },
        }))
      )
        return denied();
    const ids = new Set(content.lines.map((line) => line.id));
    await this.sourceHooks?.invalidate(
      c,
      'materialIssueRequestLine',
      requestId,
      actor,
      'SYSTEM_SOURCE_LINE_REMOVED',
      old
        .filter((r) => r.status === 'active' && !ids.has(text(r.id)))
        .map((r) => text(r.id)),
    );
    let retired = -1;
    // Temporarily park all line numbers so swaps remain valid under the unique key.
    for (const line of old)
      await this.repo(c, 'materialIssueRequestLines', p).updateOne({
        filter: { id: text(line.id) },
        values: { lineNo: retired-- },
      });
    for (const line of old.filter(
      (r) => r.status === 'active' && !ids.has(text(r.id)),
    ))
      await this.repo(c, 'materialIssueRequestLines', p).updateOne({
        filter: { id: text(line.id) },
        values: {
          status: 'cancelled',
          revision: Number(line.revision) + 1,
          inputRevision: Number(line.inputRevision) + 1,
        },
      });
    for (const [index, line] of content.lines.entries()) {
      const previous = old.find((r) => r.id === line.id);
      if (previous?.status === 'cancelled')
        return issueError(
          'ISSUE_LINE_RETIRED',
          'INVALID_ARGUMENT',
          `lines.${index}.id`,
        );
      if (
        !previous &&
        (await c
          .repository('materialIssueRequestLines')
          .exists({ filter: { id: text(line.id) } }))
      )
        return issueError(
          'ISSUE_LINE_UNAVAILABLE',
          'INVALID_ARGUMENT',
          `lines.${index}.id`,
        );
      const selection = await this.materials
        .resolveSelectionInTransaction(c, 'requisitions', line.selection, p)
        .catch((error: unknown) => {
          if (error instanceof SupplyChainError)
            throw new SupplyChainError(
              error.reason,
              `lines.${index}.selection${error.field ? `.${error.field}` : ''}`,
            );
          throw error;
        });
      const changed =
        !previous || canonical(previous.selectionInput) !== canonical(line);
      const oldInput = previous?.selectionInput as
        Record<string, unknown> | undefined;
      const inputChanged =
        (!!previousHead &&
          ((!line.usage.trim() && previousHead.usage !== content.usage) ||
            previousHead.purposeId !== content.purposeId)) ||
        !oldInput ||
        ['selection', 'originalName', 'originalSpecification', 'usage'].some(
          (key) =>
            canonical(oldInput[key]) !==
            canonical(line[key as keyof typeof line]),
        );
      if (previous && inputChanged)
        await this.sourceHooks?.invalidate(
          c,
          'materialIssueRequestLine',
          requestId,
          actor,
          'SYSTEM_SOURCE_INPUT_CHANGED',
          [text(previous.id)],
        );
      const identified = selection.identificationStatus === 'identified';
      const values: Row = {
        ...selection,
        id: line.id,
        requestId,
        subjectId: content.subjectId,
        lineNo: index + 1,
        status: 'active',
        revision:
          Number(previous?.revision ?? 0) +
          (changed || inputChanged || previous?.lineNo !== index + 1 ? 1 : 0),
        inputRevision:
          Number(previous?.inputRevision ?? 0) + (inputChanged ? 1 : 0),
        governanceAttempt: Number(previous?.governanceAttempt ?? 0),
        originalName:
          line.originalName ||
          (identified
            ? selection.materialSnapshot.name
            : selection.originalName),
        originalSpecification:
          line.originalSpecification ||
          (identified ? '' : selection.originalSpecification),
        requestedUnitText: identified
          ? text(selection.materialSnapshot.unitName)
          : selection.requestedUnitText,
        requestedUnitId: identified ? text(selection.unitId) : null,
        materialNameId: identified ? selection.materialNameId : null,
        skuRevision: identified ? selection.skuRevision : null,
        managementModeSnapshot: identified
          ? selection.managementModeSnapshot
          : null,
        unitId: identified ? selection.unitId : null,
        unitRuleId: identified ? selection.unitRuleId : null,
        unitRuleRevision: identified ? selection.unitRuleRevision : null,
        numeratorSnapshot: identified ? selection.numeratorSnapshot : null,
        denominatorSnapshot: identified ? selection.denominatorSnapshot : null,
        baseUnitId: identified ? selection.baseUnitId : null,
        materialSnapshot: identified ? selection.materialSnapshot : null,
        activeSourceLinkId: previous?.activeSourceLinkId ?? null,
        identificationStatus:
          !inputChanged && previous?.activeSourceLinkId
            ? previous.identificationStatus
            : selection.identificationStatus,
        confirmedBy: identified
          ? changed
            ? actor.id
            : (previous?.confirmedBy ?? actor.id)
          : null,
        confirmedAt: identified
          ? changed
            ? new Date()
            : (previous?.confirmedAt ?? new Date())
          : null,
        usage: line.usage,
        notes: line.notes,
        selectionInput: json(line),
      };
      if (previous)
        await this.repo(c, 'materialIssueRequestLines', p).updateOne({
          filter: { id: text(line.id) },
          values,
        });
      else
        await this.repo(c, 'materialIssueRequestLines', p).createOne({
          values,
        });
    }
  }
  async create(raw: IssueCreate, actor: LifecycleActor, access: IssueAccess) {
    const input = issueCreate.parse(raw);
    return this.action(
      'createIssueRequest',
      input,
      actor,
      access,
      async (c) => {
        return this.createInTransaction(c, input.content, actor, access);
      },
      'create',
    );
  }
  private async createInTransaction(
    c: DatabaseConnection,
    content: IssueContent,
    actor: LifecycleActor,
    access: IssueAccess,
    supersedesId: string | null = null,
    copyReason?: string,
  ) {
    const values = await this.contentValues(c, content, actor, access);
    const id = randomUUID(),
      now = new Date();
    const next: Row = {
      ...values,
      id,
      code: `IR-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().replaceAll('-', '').toUpperCase()}`,
      revision: 1,
      contentVersion: 1,
      governanceEpoch: 1,
      reviewRound: 0,
      lineCount: content.lines.length,
      identifiedCount: content.lines.filter((l) => l.selection.kind === 'known')
        .length,
      identificationStatus:
        content.lines.length > 0 &&
        content.lines.every((l) => l.selection.kind === 'known')
          ? 'identified'
          : 'unidentified',
      submittedVersionId: null,
      approvedVersionId: null,
      parameterContract: 1,
      supersedesId,
      createdBy: actor.id,
      updatedBy: actor.id,
      submittedBy: null,
      submittedAt: null,
      approvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.assertWrite(
      c,
      'materialIssueRequests',
      next,
      access.policies,
      'create',
    );
    const result = await this.runtime.create('materialIssueRequests', next, {
      actor,
      transaction: c,
    });
    await this.assertWrite(
      c,
      'materialIssueRequests',
      result.record as Row,
      access.policies,
      'create',
      id,
    );
    await this.head(c, id, access.policies);
    await this.saveLines(c, id, content, actor, access.policies);
    await this.fileHooks?.save(
      c,
      'materialIssueRequest',
      result.record as Row,
      content.attachments,
      actor,
      access.policies,
    );
    await this.audit(
      c,
      result.record as Row,
      null,
      actor,
      supersedesId ? 'copy' : 'create',
      copyReason ?? 'create',
    );
    return this.view(c, result.record as Row, access.policies);
  }
  async copy(
    id: string,
    raw: IssueUpdate,
    actor: LifecycleActor,
    access: IssueAccess,
  ) {
    const input = issueUpdate.parse(raw);
    return this.action(
      `copyIssueRequest:${id}`,
      input,
      actor,
      access,
      async (c) => {
        const source = await this.head(c, id, access.policies);
        this.expect(source, input);
        if (source.status !== 'cancelled')
          return issueError('ISSUE_COPY_REQUIRES_CANCELLED');
        await this.applicant(c, source, actor, access);
        const content = {
          ...input.content,
          lines: input.content.lines.map((line) => ({
            ...line,
            id: randomUUID(),
          })),
        };
        return this.createInTransaction(
          c,
          content,
          actor,
          access,
          id,
          input.reason,
        );
      },
      'create',
    );
  }
  async update(
    id: string,
    raw: IssueUpdate,
    actor: LifecycleActor,
    access: IssueAccess,
  ) {
    const input = issueUpdate.parse(raw);
    return this.action(
      `updateIssueRequest:${id}`,
      input,
      actor,
      access,
      async (c) => {
        await lockDemandHeader(c, 'materialIssueRequests', id);
        const before = await this.head(c, id, access.policies);
        const executionBefore = await this.lines(c, id);
        this.expect(before, input);
        if (before.status !== 'draft')
          return issueError('ISSUE_NOT_DRAFT', 'FAILED_PRECONDITION');
        if (
          Number(before.reviewRound) > 0 &&
          before.subjectId !== input.content.subjectId
        )
          return issueError(
            'ISSUE_COMPANY_FROZEN',
            'INVALID_ARGUMENT',
            'subjectId',
          );
        await this.applicant(c, before, actor, access);
        const values = {
          ...(await this.contentValues(c, input.content, actor, access)),
          contentVersion: Number(before.contentVersion) + 1,
          lineCount: input.content.lines.length,
          identifiedCount: input.content.lines.filter(
            (l) => l.selection.kind === 'known',
          ).length,
          identificationStatus:
            input.content.lines.length > 0 &&
            input.content.lines.every((l) => l.selection.kind === 'known')
              ? 'identified'
              : 'unidentified',
          approvedVersionId: null,
          submittedVersionId: null,
        };
        await this.assertWrite(
          c,
          'materialIssueRequests',
          { ...values, updatedBy: actor.id },
          access.policies,
          'update',
          id,
        );
        // The parent moves first so the composite parent/company FK can validate new lines.
        if (
          before.subjectId !== input.content.subjectId &&
          (await this.lines(c, id)).length
        )
          return issueError(
            'ISSUE_COMPANY_HAS_LINES',
            'INVALID_ARGUMENT',
            'subjectId',
          );
        const result = await this.runtime.fire(
          'materialIssueRequests',
          id,
          'edit',
          {
            actor,
            expect: { version: input.lifecycleVersion },
            input: { values: json(values), reason: input.reason },
            requestId: input.requestKey,
            transaction: c,
          },
        );
        await this.assertWrite(
          c,
          'materialIssueRequests',
          this.changes(before, result.record as Row),
          access.policies,
          'update',
          id,
        );
        await this.saveLines(
          c,
          id,
          input.content,
          actor,
          access.policies,
          before,
        );
        await guardDemandExecution(c, 'issue', id, executionBefore);
        await this.fileHooks?.save(
          c,
          'materialIssueRequest',
          result.record as Row,
          input.content.attachments,
          actor,
          access.policies,
        );
        await this.audit(
          c,
          result.record as Row,
          before,
          actor,
          'edit',
          input.reason,
        );
        return this.view(c, result.record as Row, access.policies);
      },
    );
  }
  private expect(
    row: Row,
    input: { version: number; lifecycleVersion: number },
  ) {
    if (
      row.revision !== input.version ||
      row.lifecycleVersion !== input.lifecycleVersion
    )
      return issueError('ISSUE_VERSION_CONFLICT', 'ABORTED');
  }
  private async currentTask(c: DatabaseConnection, row: Row) {
    const task = await c.repository('supplyChainReviewTasks').findOne({
      filter: {
        issueRequestId: text(row.id),
        kind: 'materialIssueRequest',
        round: Number(row.reviewRound),
        status: 'pending',
        versionId: text(row.submittedVersionId),
      },
    });
    if (!task) return issueError('ISSUE_REVIEW_STALE', 'ABORTED');
    return task;
  }
  private async eligible(
    c: DatabaseConnection,
    accountId: string,
    subjectId: string,
    excluded: string[],
  ) {
    if (excluded.includes(accountId)) return false;
    const user = await this.users.withConnection(c).get(accountId);
    if (!user || user.disabledAt || user.kind !== 'person') return false;
    const person = await c
      .repository('personnelEmployees')
      .findOne({ filter: { accountId, status: 'active' } });
    if (!person) return false;
    try {
      await this.activeEmployee(c, text(person.id), subjectId);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.reason === 'ISSUE_PERSON_UNAVAILABLE'
      )
        return false;
      throw error;
    }
    return (await this.positionsFor(c, text(person.id), subjectId)).length > 0;
  }
  private async candidates(
    c: DatabaseConnection,
    row: Row,
    rules: unknown,
    actorId: string,
  ) {
    const excluded = [
      ...new Set(
        [
          text(row.createdBy),
          text(row.requesterAccountId),
          text(row.recipientAccountId),
          actorId,
          text(row.submittedBy),
        ].filter(Boolean),
      ),
    ];
    const subjectId = text(row.subjectId);
    const candidates = await resolveReviewerSelections(
      rules as ReviewerSelection[],
      {
        scope: reviewScope('requisitions', subjectId),
        applicantId: text(row.requesterAccountId),
        transactionHandle: c,
      },
      {
        selectors: {
          user: async (id) => [id],
          position: async (id) => {
            const position = await c
              .repository('orgPositions')
              .findOne({ filter: { id, status: 'active' } });
            if (
              !position ||
              !(await c.repository('orgUnits').exists({
                filter: {
                  id: text(position.unitId),
                  subjectId,
                  status: 'active',
                },
              }))
            )
              return [];
            const assignments = await c
              .repository('personnelAssignments')
              .findMany({
                filter: { positionId: id, subjectId, status: 'active' },
                limit: 10001,
              });
            if (assignments.length > 10000)
              return issueError('ISSUE_REFERENCE_TOO_BROAD');
            const accounts: string[] = [];
            for (const assignment of assignments)
              if (this.effective(assignment, businessDate(this.timeZone))) {
                const person = await c
                  .repository('personnelEmployees')
                  .findOne({
                    filter: { id: text(assignment.personId), status: 'active' },
                  });
                if (person?.accountId) accounts.push(text(person.accountId));
              }
            return accounts;
          },
        },
        eligible: (id) => this.eligible(c, id, subjectId, excluded),
      },
    );
    if (!candidates.length)
      return issueError(
        'ISSUE_REVIEWERS_EMPTY',
        'FAILED_PRECONDITION',
        'reviewerSelections',
      );
    return { candidates: [...candidates], excludedActors: excluded };
  }
  private async checkReview(
    c: DatabaseConnection,
    record: Row,
    actor: LifecycleActor,
    operation: string,
    parameters: {
      reviewerSelections?: unknown;
      allowParallelGovernance?: unknown;
    },
  ) {
    if (operation === 'submit') {
      const candidates = await this.candidates(
        c,
        record,
        parameters.reviewerSelections,
        actor.id,
      );
      if (
        !parameters.allowParallelGovernance &&
        record.identifiedCount !== record.lineCount
      )
        return issueError(
          'ISSUE_MATERIALS_REQUIRED',
          'FAILED_PRECONDITION',
          'lines',
        );
      return candidates;
    }
    const task = await this.currentTask(c, record);
    if (operation === 'reassign') {
      for (const candidate of task.candidates as string[])
        if (
          await this.eligible(
            c,
            candidate,
            text(record.subjectId),
            task.excludedActors as string[],
          )
        )
          return issueError('ISSUE_REVIEWERS_STILL_AVAILABLE');
      return this.candidates(
        c,
        record,
        parameters.reviewerSelections,
        actor.id,
      );
    }
    const requester = await c
      .repository('personnelEmployees')
      .findOne({ filter: { id: text(record.requesterEmployeeId) } });
    const recipient = await c
      .repository('personnelEmployees')
      .findOne({ filter: { id: text(record.recipientEmployeeId) } });
    if (
      !(task.candidates as string[]).includes(actor.id) ||
      !(await this.eligible(c, actor.id, text(record.subjectId), [
        ...(task.excludedActors as string[]),
        text(requester?.accountId),
        text(recipient?.accountId),
      ]))
    )
      return issueError('ISSUE_REVIEW_DENIED', 'PERMISSION_DENIED');
    return undefined;
  }
  private async reviewParameters(c: DatabaseConnection, row: Row) {
    const scope = reviewScope('requisitions', text(row.subjectId));
    const snapshot = await this.parameters.snapshot(
      scope,
      'materialIssueRequests',
      text(row.id),
      c,
    );
    if (snapshot) return snapshot.values;
    if (Number(row.reviewRound) > 0)
      return issueError('ISSUE_CONFIGURATION_INCOMPATIBLE');
    const current = await this.parameters.read(scope, issueRuleGroup.key, c);
    return current
      ? normalizeParameterValues(issueRuleGroup, current.values)
      : json(issueRuleDefaults);
  }
  async capabilities(
    id: string,
    actor: LifecycleActor,
    read: IssueAccess,
    access: Record<string, IssueAccess | null>,
  ) {
    return this.db.transaction((c) =>
      this.capabilitiesInConnection(c, id, actor, read, access),
    );
  }
  private async capabilitiesInConnection(
    c: DatabaseConnection,
    id: string,
    actor: LifecycleActor,
    read: IssueAccess,
    access: Record<string, IssueAccess | null>,
  ) {
    const row = await this.head(c, id, read.policies);
    const from: Record<string, string[]> = {
      update: ['draft'],
      submit: ['draft'],
      approve: ['pending'],
      return: ['pending'],
      withdraw: ['pending'],
      revise: ['approved'],
      cancel: ['draft', 'pending', 'approved'],
      reassign: ['pending'],
      copy: ['cancelled'],
      requestGovernance: ['draft', 'pending', 'approved'],
      confirmMaterial: ['draft', 'pending', 'approved'],
      rejectMaterial: ['draft', 'pending', 'approved'],
      takeOverSource: ['draft', 'pending', 'approved'],
    };
    const actions: Record<
      string,
      { visible: boolean; enabled: boolean; reason: string | null }
    > = {};
    for (const [action, states] of Object.entries(from)) {
      const grant = access[action];
      if (!grant) {
        actions[action] = { visible: false, enabled: false, reason: null };
        continue;
      }
      try {
        await this.head(c, id, grant.policies);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        actions[action] = {
          visible: true,
          enabled: false,
          reason: error.reason ?? 'ISSUE_FORBIDDEN',
        };
        continue;
      }
      if (!states.includes(text(row.status))) {
        actions[action] = {
          visible: true,
          enabled: false,
          reason: 'ISSUE_ACTION_UNAVAILABLE',
        };
        continue;
      }
      try {
        if (!['approve', 'return', 'reassign'].includes(action))
          await this.applicant(c, row, actor, grant);
        if (action === 'copy') {
          if (!grant.policies.materialIssueRequests?.create) return denied();
        } else {
          await this.assertWrite(
            c,
            'materialIssueRequests',
            { updatedBy: actor.id },
            grant.policies,
            'update',
            id,
          );
        }
        if (action === 'submit') {
          await this.validateSubmission(c, row, actor, grant, true);
          await this.sourceHooks?.checkSubmission(
            c,
            'materialIssueRequestLine',
            id,
            actor,
            grant.source,
          );
        }
        if (['submit', 'approve', 'return', 'reassign'].includes(action))
          await this.checkReview(
            c,
            row,
            actor,
            action,
            await this.reviewParameters(c, row),
          );
        actions[action] = { visible: true, enabled: true, reason: null };
      } catch (error) {
        if (error instanceof ApiError)
          actions[action] = {
            visible: true,
            enabled: false,
            reason: error.reason ?? 'ISSUE_ACTION_UNAVAILABLE',
          };
        else if (
          error instanceof Error &&
          'reason' in error &&
          typeof error.reason === 'string'
        )
          actions[action] = {
            visible: true,
            enabled: false,
            reason: error.reason,
          };
        else throw error;
      }
    }
    return {
      recordRevision: Number(row.revision),
      lifecycleVersion: Number(row.lifecycleVersion),
      actions,
    };
  }
  private async prepare(
    c: DatabaseConnection,
    context: TransitionContext<IssueWorkflowTypes>,
    operation: string,
  ): Promise<JsonObject> {
    const { actor, input, parameters } = context;
    const record = context.record as Row;
    if (operation.startsWith('source'))
      return (input.values ?? {}) as JsonObject;
    if (operation === 'confirmMaterial') {
      if (record.status === 'pending') {
        const task = await this.currentTask(c, record);
        await c.repository('supplyChainReviewTasks').updateOne({
          filter: { id: text(task.id), status: 'pending' },
          values: {
            status: 'closed',
            decidedBy: actor.id,
            reason: text(input.reason),
            decidedAt: new Date(),
          },
        });
      }
      return {
        ...((input.values ?? {}) as JsonObject),
        contentVersion: Number(record.contentVersion) + 1,
        submittedVersionId: null,
        approvedVersionId: null,
        approvedAt: null,
      };
    }
    if (operation === 'edit') return (input.values ?? {}) as JsonObject;
    if (operation === 'submit') {
      const candidates = await this.checkReview(
        c,
        record,
        actor,
        'submit',
        parameters,
      );
      let version = await c.repository('supplyChainRequestVersions').findOne({
        filter: {
          kind: 'materialIssueRequest',
          issueRequestId: text(record.id),
          contentVersion: Number(record.contentVersion),
        },
      });
      if (!version) {
        const company = await c
          .repository('orgSubjects')
          .findOne({ filter: { id: text(record.subjectId) } });
        const person = await c
          .repository('personnelEmployees')
          .findOne({ filter: { id: text(record.requesterEmployeeId) } });
        const recipient = await c
          .repository('personnelEmployees')
          .findOne({ filter: { id: text(record.recipientEmployeeId) } });
        const unit = await c
          .repository('orgUnits')
          .findOne({ filter: { id: text(record.requestingUnitId) } });
        version = (
          await c.repository('supplyChainRequestVersions').createOne({
            values: {
              id: randomUUID(),
              kind: 'materialIssueRequest',
              issueRequestId: record.id,
              subjectId: record.subjectId,
              contentVersion: record.contentVersion,
              payload: json({
                head: record,
                company: {
                  id: company?.id,
                  code: company?.code,
                  name: company?.name,
                },
                recipient: {
                  id: recipient?.id,
                  code: recipient?.code,
                  name: recipient?.name,
                },
                requester: {
                  id: person?.id,
                  code: person?.code,
                  name: person?.name,
                },
                unit: { id: unit?.id, code: unit?.code, name: unit?.name },
                lines: (await this.lines(c, text(record.id))).filter(
                  (r) => r.status === 'active',
                ),
                attachments:
                  (await this.fileHooks?.read(
                    c,
                    'materialIssueRequest',
                    text(record.id),
                  )) ?? [],
                parameterSnapshot: await this.parameters.snapshot(
                  reviewScope('requisitions', text(record.subjectId)),
                  'materialIssueRequests',
                  text(record.id),
                  c,
                ),
              }),
              createdAt: new Date(),
            },
          })
        ).record;
      }
      await this.fileHooks?.freeze(
        c,
        'materialIssueRequest',
        record,
        text(version.id),
      );
      const round = Number(record.reviewRound) + 1;
      await c.repository('supplyChainReviewTasks').createOne({
        values: {
          id: randomUUID(),
          kind: 'materialIssueRequest',
          issueRequestId: record.id,
          subjectId: record.subjectId,
          round,
          versionId: version.id,
          ...candidates,
          status: 'pending',
          decidedBy: null,
          reason: '',
          decidedAt: null,
          createdAt: new Date(),
        },
      });
      return {
        reviewRound: round,
        submittedVersionId: text(version.id),
        submittedBy: actor.id,
        submittedAt: new Date().toISOString(),
        approvedVersionId: null,
        approvedAt: null,
      };
    }
    if (operation === 'reassign') {
      const task = await this.currentTask(c, record);
      const next = await this.checkReview(
        c,
        record,
        actor,
        'reassign',
        parameters,
      );
      await c.repository('supplyChainReviewTasks').updateOne({
        filter: { id: text(task.id), status: 'pending' },
        values: {
          status: 'reassigned',
          decidedBy: actor.id,
          reason: text(input.reason),
          decidedAt: new Date(),
        },
      });
      await c.repository('supplyChainReviewTasks').createOne({
        values: {
          id: randomUUID(),
          kind: 'materialIssueRequest',
          issueRequestId: record.id,
          subjectId: record.subjectId,
          round: Number(record.reviewRound) + 1,
          versionId: record.submittedVersionId,
          ...next,
          status: 'pending',
          decidedBy: null,
          reason: '',
          decidedAt: null,
          createdAt: new Date(),
        },
      });
      return { reviewRound: Number(record.reviewRound) + 1 };
    }
    if (operation === 'cancel') {
      const issued = await c.repository('stockIssueFulfillments').findMany({
        filter: { issueRequestId: text(record.id) },
        limit: 10001,
      });
      if (
        issued.some(
          (row) =>
            stockMicros(text(row.issuedQuantity)) >
            stockMicros(text(row.returnedQuantity)),
        )
      )
        return issueError('ISSUE_ALREADY_ISSUED', 'FAILED_PRECONDITION');
    }
    if (record.status === 'pending') {
      const task = await this.currentTask(c, record);
      if (operation === 'approve' || operation === 'return') {
        await this.checkReview(c, record, actor, operation, parameters);
      }
      await c.repository('supplyChainReviewTasks').updateOne({
        filter: { id: text(task.id), status: 'pending' },
        values: {
          status:
            operation === 'approve'
              ? 'approved'
              : operation === 'return'
                ? 'returned'
                : 'closed',
          decidedBy: actor.id,
          reason: text(input.reason),
          decidedAt: new Date(),
        },
      });
    }
    if (operation === 'approve')
      return {
        approvedVersionId: text(record.submittedVersionId),
        approvedAt: new Date().toISOString(),
      };
    await this.sourceHooks?.invalidate(
      c,
      'materialIssueRequestLine',
      text(record.id),
      actor,
      text(input.reason),
    );
    return {
      governanceEpoch: Number(record.governanceEpoch) + 1,
      submittedVersionId: null,
      approvedVersionId: null,
      approvedAt: null,
    };
  }
  private async validateSubmission(
    c: DatabaseConnection,
    before: Row,
    actor: LifecycleActor,
    access: IssueAccess,
    readOnly = false,
  ) {
    const id = text(before.id);
    const lines = (await this.lines(c, id, access.policies)).filter(
      (r) => r.status === 'active',
    );
    if (lines.length !== Number(before.lineCount)) return denied();
    const content: IssueContent = {
      subjectId: text(before.subjectId),
      requesterEmployeeId: text(before.requesterEmployeeId) || null,
      recipientEmployeeId: text(before.recipientEmployeeId) || null,
      requestingUnitId: text(before.requestingUnitId) || null,
      usage: text(before.usage),
      neededOn: text(before.neededOn) || null,
      purposeId: text(before.purposeId) || null,
      projectId: null,
      notes: text(before.notes),
      lines: lines.map(
        (line) => line.selectionInput as IssueContent['lines'][number],
      ),
    };
    const validated = await this.contentValues(
      c,
      content,
      actor,
      access,
      true,
      readOnly,
    );
    if (
      canonical(validated.purposeSnapshot) !== canonical(before.purposeSnapshot)
    )
      return issueError(
        'ISSUE_PURPOSE_CHANGED',
        'FAILED_PRECONDITION',
        'purposeId',
      );
    // Revalidate current references, but never silently replace a reviewed material snapshot.
    for (const [index, line] of content.lines.entries()) {
      const resolved = await (
        readOnly
          ? this.materials.previewSelectionInTransaction.bind(this.materials)
          : this.materials.resolveSelectionInTransaction.bind(this.materials)
      )(c, 'requisitions', line.selection, access.policies);
      if (
        resolved.identificationStatus === 'identified' &&
        ['skuRevision', 'unitRuleRevision', 'baseQuantity'].some(
          (key) =>
            canonical(lines[index][key]) !==
            canonical(resolved[key as keyof typeof resolved]),
        )
      )
        return issueError(
          'ISSUE_MATERIAL_CHANGED',
          'FAILED_PRECONDITION',
          `lines.${index}.selection`,
        );
    }
    return validated;
  }
  async fire(
    id: string,
    raw: IssueAction,
    actor: LifecycleActor,
    access: IssueAccess,
  ) {
    const input = issueAction.parse(raw);
    return this.action(`issueAction:${id}`, input, actor, access, async (c) => {
      await lockDemandHeader(c, 'materialIssueRequests', id);
      let before = await this.head(c, id, access.policies);
      this.expect(before, input);
      if (['revise', 'cancel'].includes(input.transition))
        await guardIssueReservations(c, id);
      if (!['approve', 'return', 'reassign'].includes(input.transition))
        await this.applicant(c, before, actor, access);
      await this.assertWrite(
        c,
        'materialIssueRequests',
        { updatedBy: actor.id },
        access.policies,
        'update',
        id,
      );
      if (input.transition === 'submit') {
        const validated = await this.validateSubmission(
          c,
          before,
          actor,
          access,
        );
        // The current employee account binding is authoritative for self-review exclusions.
        await this.repo(c, 'materialIssueRequests', access.policies).updateOne({
          filter: { id, revision: input.version },
          values: {
            requesterAccountId: validated.requesterAccountId,
            recipientAccountId: validated.recipientAccountId,
          },
        });
        before = await this.head(c, id, access.policies);
        await this.sourceHooks?.submit(
          c,
          'materialIssueRequestLine',
          id,
          actor,
          access.source,
          input.reason,
        );
      }
      const result = await this.runtime.fire(
        'materialIssueRequests',
        id,
        input.transition,
        {
          actor,
          expect: { version: input.lifecycleVersion },
          input: { reason: input.reason },
          requestId: input.requestKey,
          transaction: c,
        },
      );
      await this.assertWrite(
        c,
        'materialIssueRequests',
        this.changes(before, result.record as Row),
        access.policies,
        'update',
        id,
      );
      await this.audit(
        c,
        result.record as Row,
        before,
        actor,
        input.transition,
        input.reason,
      );
      return this.view(c, result.record as Row, access.policies);
    });
  }
  async materialOption(subjectId: string, id: string, p: MaterialPolicies) {
    const result = await this.materials.detail(
      'requisitions',
      subjectId,
      id,
      p,
    );
    const detail = result.data as Row;
    const packages = Array.isArray(detail.packages)
      ? (detail.packages as Row[])
      : [];
    return {
      data: {
        ...detail,
        packages: await Promise.all(
          packages.map(async (pack) => ({
            ...pack,
            unitName:
              (
                await this.reference(
                  this.db.connection(),
                  'measureUnits',
                  pack.unitId,
                  p,
                )
              )?.name ?? '',
          })),
        ),
      },
    };
  }
  async companies(query: IssuePage, p: MaterialPolicies) {
    const result = await this.purposes.companies(
      { ...query, q: query.q ?? '' },
      p,
    );
    return {
      ...result,
      meta: {
        ...result.meta,
        businessDate: businessDate(this.timeZone),
        timeZone: this.timeZone,
      },
    };
  }
  async options(
    query: IssueOptionQuery,
    actor: LifecycleActor,
    access: IssueAccess,
    configuration = false,
  ) {
    const c = this.db.connection(),
      p = access.policies;
    await this.company(c, query.subjectId, p);
    const allPeople =
      configuration || (await this.canDelegate(c, query.subjectId, access));
    const search = (f: FilterBuilder) =>
      query.q
        ? f.or(
            ['code', 'name'].map((key) =>
              f.string(key).includes(query.q!, { mode: 'insensitive' }),
            ),
          )
        : f.string('status').eq('active');
    let rows: Row[] = [];
    if (query.kind === 'units') {
      let unitIds: string[] | undefined;
      if (query.requesterEmployeeId) {
        const person = await this.activeEmployee(
          c,
          query.requesterEmployeeId,
          query.subjectId,
          p,
        );
        if (!allPeople && person.accountId !== actor.id) return denied();
        unitIds = (
          await this.positionsFor(c, query.requesterEmployeeId, query.subjectId)
        ).map((r) => text(r.unitId));
      }
      rows = await this.repo(c, 'orgUnits', p).findMany({
        filter: (f) =>
          f.and([
            f.string('subjectId').eq(query.subjectId),
            f.string('status').eq('active'),
            ...(unitIds ? [materialIdFilter(f, 'id', unitIds)] : []),
            search(f),
          ]),
        limit: 10001,
      });
    } else if (query.kind === 'positions') {
      const units = await this.repo(c, 'orgUnits', p).findMany({
        filter: { subjectId: query.subjectId, status: 'active' },
        limit: 10001,
      });
      if (units.length > 10000) return issueError('ISSUE_REFERENCE_TOO_BROAD');
      rows = await this.repo(c, 'orgPositions', p).findMany({
        filter: (f) =>
          f.and([
            materialIdFilter(
              f,
              'unitId',
              units.map((u) => text(u.id)),
            ),
            f.string('status').eq('active'),
            search(f),
          ]),
        limit: 10001,
      });
    } else {
      if (query.kind === 'reviewers' && !configuration) return denied();
      const people = await this.repo(c, 'personnelEmployees', p).findMany({
        filter: (f) =>
          f.and([
            f.string('status').eq('active'),
            ...(allPeople ? [] : [f.string('accountId').eq(actor.id)]),
            search(f),
          ]),
        limit: 10001,
      });
      if (people.length > 10000) return issueError('ISSUE_REFERENCE_TOO_BROAD');
      for (const person of people) {
        try {
          await this.activeEmployee(c, text(person.id), query.subjectId, p);
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.reason === 'ISSUE_PERSON_UNAVAILABLE'
          )
            continue;
          throw error;
        }
        if (
          !(await this.positionsFor(c, text(person.id), query.subjectId)).length
        )
          continue;
        if (query.kind === 'reviewers') {
          if (
            person.accountId &&
            (await this.eligible(
              c,
              text(person.accountId),
              query.subjectId,
              [],
            ))
          )
            rows.push({
              id: person.accountId,
              code: person.code,
              name: person.name,
            });
        } else rows.push(person);
      }
    }
    if (rows.length > 10000) return issueError('ISSUE_REFERENCE_TOO_BROAD');
    rows.sort(
      (a, b) =>
        text(a.code).localeCompare(text(b.code)) ||
        text(a.id).localeCompare(text(b.id)),
    );
    return {
      data: rows
        .slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
        .map((r) => ({
          id: text(r.id),
          code: text(r.code),
          name: text(r.name),
        })),
      meta: { page: query.page, pageSize: query.pageSize, total: rows.length },
    };
  }
  async settings(subjectId: string, p: MaterialPolicies) {
    await this.company(this.db.connection(), subjectId, p);
    const current = await this.parameters.read(
      reviewScope('requisitions', subjectId),
      issueRuleGroup.key,
    );
    const values = current
      ? normalizeParameterValues(issueRuleGroup, current.values)
      : issueRuleDefaults;
    if (current && current.schemaVersion !== 1)
      return issueError('ISSUE_CONFIGURATION_INCOMPATIBLE');
    return {
      subjectId,
      revision: current?.revision ?? 0,
      values,
      references: await this.ruleReferences(
        this.db.connection(),
        subjectId,
        values.reviewerSelections,
        p,
      ),
      schemaVersion: 1 as const,
      readMode: 'snapshot' as const,
      fields: reviewRuleFields(
        this.runtime,
        'materialIssueRequests',
        issueRuleGroup.key,
        ['requireProject'],
      ),
    };
  }
  private async ruleReferences(
    c: DatabaseConnection,
    subjectId: string,
    raw: unknown,
    p: MaterialPolicies,
  ) {
    const selections = issueRules.parse({
      ...issueRuleDefaults,
      reviewerSelections: raw,
    }).reviewerSelections;
    return Promise.all(
      selections.map(async (choice) => {
        let ref =
          choice.type === 'position'
            ? await this.reference(c, 'orgPositions', choice.referenceId, p)
            : await this.accountReference(c, choice.referenceId, p);
        if (ref && choice.type === 'position') {
          const position = await this.repo(c, 'orgPositions', p).findOne({
            filter: { id: choice.referenceId },
          });
          if (
            !position ||
            !(await this.repo(c, 'orgUnits', p).exists({
              filter: { id: text(position.unitId), subjectId },
            }))
          )
            ref = null;
        }
        if (
          ref &&
          choice.type === 'user' &&
          !(await this.eligible(c, choice.referenceId, subjectId, []))
        )
          ref = { ...ref, availability: 'inactive' };
        return {
          ...choice,
          ...ref,
          availability: ref?.availability ?? 'unavailable',
        };
      }),
    );
  }
  async saveSettings(
    raw: IssueSettingsSave,
    actor: LifecycleActor,
    p: MaterialPolicies,
  ) {
    const input = issueSettingsSave.parse(raw);
    return this.db.transaction(async (c) => {
      await this.lock(c);
      await this.company(c, input.subjectId, p);
      const values = normalizeParameterValues(
        issueRuleGroup,
        json(input.values),
      );
      if (!input.values.reviewerSelections.length)
        return issueError(
          'ISSUE_REVIEWERS_EMPTY',
          'INVALID_ARGUMENT',
          'reviewerSelections',
        );
      for (const choice of input.values.reviewerSelections) {
        if (choice.type === 'position') {
          const position = await this.repo(c, 'orgPositions', p).findOne({
            filter: { id: choice.referenceId, status: 'active' },
          });
          if (
            !position ||
            !(await this.repo(c, 'orgUnits', p).exists({
              filter: {
                id: text(position.unitId),
                subjectId: input.subjectId,
                status: 'active',
              },
            }))
          )
            return issueError(
              'ISSUE_REVIEW_REFERENCE_UNAVAILABLE',
              'INVALID_ARGUMENT',
              'reviewerSelections',
            );
        } else if (
          !(await this.eligible(c, choice.referenceId, input.subjectId, []))
        )
          return issueError(
            'ISSUE_REVIEW_REFERENCE_UNAVAILABLE',
            'INVALID_ARGUMENT',
            'reviewerSelections',
          );
      }
      const version = await this.parameters.save(
        {
          scope: reviewScope('requisitions', input.subjectId),
          group: issueRuleGroup,
          values,
          expectedRevision: input.version,
          requestId: input.requestKey,
          actorId: actor.id,
          at: new Date().toISOString(),
        },
        c,
      );
      return {
        subjectId: input.subjectId,
        revision: version.revision,
        values: issueRules.parse(version.values),
        references: await this.ruleReferences(
          c,
          input.subjectId,
          version.values.reviewerSelections,
          p,
        ),
        schemaVersion: 1 as const,
        readMode: 'snapshot' as const,
      };
    });
  }
}

import { randomUUID } from 'node:crypto';
import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryRecord,
} from '@nocobase/db';
import {
  StoredLifecycleParameters,
  createRepositoryLifecycleStore,
  type LifecycleRuntime,
  type JsonObject,
  type TransitionContext,
  type ReviewerSelection,
} from '@nocobase/lifecycle';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import { issueParameterCollections } from './issue-request-workflow.js';
import { ExecutionReviewers } from './execution-reviewers.js';
import {
  executionLifecycle,
  executionParentField,
  executionRuleGroup,
  executionRules,
  type ExecutionKind,
  type ExecutionWorkflowTypes,
} from './execution-workflow.js';
import { reviewRuleFields } from './review-rule-fields.js';
import { reviewScope } from './review-scope.js';
import {
  executionJson as json,
  executionText as text,
} from './execution-access.js';
import { inventoryError as fail } from './inventory-quantity.js';

export class ExecutionReviewService {
  readonly parameters: StoredLifecycleParameters;
  readonly reviewers: ExecutionReviewers;
  constructor(
    db: DatabaseManager,
    private readonly runtime: LifecycleRuntime,
    private readonly users: UserAdministrationService,
    timeZone: string,
  ) {
    this.parameters = new StoredLifecycleParameters(
      createRepositoryLifecycleStore(db),
      issueParameterCollections,
    );
    this.reviewers = new ExecutionReviewers(users, timeZone);
  }
  register(
    kind: ExecutionKind,
    prepare: (
      c: DatabaseConnection,
      context: TransitionContext<ExecutionWorkflowTypes>,
      operation: string,
    ) => Promise<JsonObject>,
  ) {
    this.runtime.register(executionLifecycle(kind), {
      parameterConfiguration: {
        store: this.parameters,
        scope: ({ record, values }) =>
          reviewScope(kind, text(record?.subjectId ?? values?.subjectId)),
        legacyRecord: () => false,
        snapshotRequired: (record) => Number(record.reviewRound) > 0,
      },
      services: (handle) => ({
        prepare: (context, operation) =>
          prepare(handle as DatabaseConnection, context, operation),
      }),
    });
  }
  private async task(
    c: DatabaseConnection,
    kind: ExecutionKind,
    head: RepositoryRecord,
  ) {
    const task = await c.repository('executionReviewTasks').findOne({
      filter: {
        kind,
        documentId: text(head.id),
        subjectId: text(head.subjectId),
        round: Number(head.reviewRound),
        versionId: text(head.submittedVersionId),
        status: 'pending',
      },
    });
    if (!task) return fail('STOCK_REVIEW_CONFLICT');
    return task;
  }
  private excluded(
    head: RepositoryRecord,
    lines: readonly RepositoryRecord[],
    actorId: string,
  ) {
    return [
      ...new Set(
        [
          text(head.createdBy),
          text(head.submittedBy),
          text(head.requesterAccountId),
          text(head.recipientAccountId),
          actorId,
          ...lines.map((line) => text(line.countedBy)),
          ...(Array.isArray(head.countedActors)
            ? head.countedActors.map(text)
            : []),
        ].filter(Boolean),
      ),
    ];
  }
  async canReview(
    c: DatabaseConnection,
    kind: ExecutionKind,
    head: RepositoryRecord,
    actorId: string,
  ) {
    const task = await this.task(c, kind, head);
    return (
      (task.candidates as string[]).includes(actorId) &&
      (await this.reviewers.eligible(
        c,
        actorId,
        text(head.subjectId),
        task.excludedActors as string[],
      ))
    );
  }
  async prepare(
    c: DatabaseConnection,
    kind: ExecutionKind,
    context: TransitionContext<ExecutionWorkflowTypes>,
    operation: string,
    lines: RepositoryRecord[],
  ): Promise<JsonObject> {
    const head = context.record as RepositoryRecord,
      actorId = context.actor.id,
      subjectId = text(head.subjectId),
      documentId = text(head.id);
    if (operation === 'submit') {
      if (!lines.length && kind !== 'stockCounts')
        return fail('STOCK_LINES_INVALID', 'lines');
      if (kind === 'purchaseOrders') {
        const mode = text(head.demandMode),
          reason = text(head.temporaryReason ?? '').trim(),
          allocations = await c.repository('purchaseAllocations').findMany({
            filter: { orderId: documentId, status: 'active' },
            limit: 1001,
          });
        if (mode === 'temporary') {
          if (reason.length < 5)
            return fail('STOCK_DEMAND_REASON_REQUIRED', 'temporaryReason');
          if (allocations.length)
            return fail('STOCK_DEMAND_MODE_CONFLICT', 'demandMode');
        } else if (mode === 'request') {
          if (!allocations.length)
            return fail('STOCK_DEMAND_ALLOCATION_REQUIRED', 'demandMode');
        } else return fail('STOCK_DEMAND_MODE_REQUIRED', 'demandMode');
      }
      const excludedActors = this.excluded(head, lines, actorId),
        candidates = await this.reviewers.resolve(
          c,
          subjectId,
          context.parameters.reviewerSelections as ReviewerSelection[],
          excludedActors,
        );
      let version = await c.repository('executionVersions').findOne({
        filter: {
          kind,
          documentId,
          contentVersion: Number(head.contentVersion),
        },
      });
      if (!version) {
        version = (
          await c.repository('executionVersions').createOne({
            values: {
              id: randomUUID(),
              kind,
              documentId,
              subjectId,
              purchaseOrderId: null,
              salesOrderId: null,
              stockDocumentId: null,
              transferId: null,
              countId: null,
              [executionParentField[kind]]: documentId,
              contentVersion: Number(head.contentVersion),
              payload: json({ head, lines }),
              createdAt: new Date(),
            },
          })
        ).record;
      }
      const rules = executionRules.parse({
          reviewerSelections: context.parameters.reviewerSelections,
        }),
        revision =
          (
            await this.parameters.read(
              reviewScope(kind, subjectId),
              executionRuleGroup.key,
              c,
            )
          )?.revision ?? null,
        references = [];
      for (const selection of rules.reviewerSelections) {
        let label: { name: string | null; code: string | null } = {
          name: null,
          code: null,
        };
        if (selection.type === 'user') {
          const user = await this.users
            .withConnection(c)
            .get(selection.referenceId);
          label = { name: user?.name ?? null, code: null };
        } else {
          const position = await c
            .repository('orgPositions')
            .findOne({ filter: { id: selection.referenceId } });
          if (
            position &&
            (await c
              .repository('orgUnits')
              .exists({ filter: { id: text(position.unitId), subjectId } }))
          )
            label = { name: text(position.name), code: text(position.code) };
        }
        references.push({ ...selection, ...label });
      }
      await c.repository('executionReviewTasks').createOne({
        values: {
          id: randomUUID(),
          kind,
          documentId,
          subjectId,
          versionId: version.id,
          round: Number(head.reviewRound) + 1,
          status: 'pending',
          candidates,
          excludedActors,
          parameterSnapshot: json({ values: rules, references, revision }),
          submittedBy: actorId,
          decidedBy: null,
          reason: '',
          createdAt: new Date(),
          decidedAt: null,
        },
      });
      return {
        submittedVersionId: text(version.id),
        approvedVersionId: null,
        reviewRound: Number(head.reviewRound) + 1,
        submittedBy: actorId,
        submittedAt: new Date().toISOString(),
        approvedAt: null,
      };
    }
    if (operation === 'reassign') {
      const task = await this.task(c, kind, head);
      for (const id of task.candidates as string[])
        if (
          await this.reviewers.eligible(
            c,
            id,
            subjectId,
            task.excludedActors as string[],
          )
        )
          return fail('STOCK_REVIEWERS_STILL_AVAILABLE');
      const excludedActors = [
          ...new Set([
            ...(task.excludedActors as string[]),
            ...this.excluded(head, lines, actorId),
          ]),
        ],
        candidates = await this.reviewers.resolve(
          c,
          subjectId,
          context.parameters.reviewerSelections as ReviewerSelection[],
          excludedActors,
        );
      await c.repository('executionReviewTasks').updateOne({
        filter: { id: text(task.id), status: 'pending' },
        values: { candidates, excludedActors },
      });
      await c.repository('supplyChainAudit').createOne({
        values: {
          id: randomUUID(),
          kind: 'executionReviewTasks',
          recordId: task.id,
          subjectId,
          actorId,
          operation,
          reason: text(context.input.reason),
          beforeValue: json(task),
          afterValue: json({ ...task, candidates, excludedActors }),
          createdAt: new Date(),
        },
      });
      return {};
    }
    if (
      head.status === 'pending' &&
      ['approve', 'return', 'withdraw', 'cancel'].includes(operation)
    ) {
      const task = await this.task(c, kind, head);
      if (
        ['approve', 'return'].includes(operation) &&
        !(await this.canReview(c, kind, head, actorId))
      )
        return fail('STOCK_REVIEW_FORBIDDEN');
      await c.repository('executionReviewTasks').updateOne({
        filter: { id: text(task.id), status: 'pending' },
        values: {
          status:
            operation === 'approve'
              ? 'approved'
              : operation === 'return'
                ? 'returned'
                : 'closed',
          decidedBy: actorId,
          reason: text(context.input.reason),
          decidedAt: new Date(),
        },
      });
    }
    if (operation === 'approve')
      return {
        approvedVersionId: text(head.submittedVersionId),
        approvedAt: new Date().toISOString(),
      };
    if (['return', 'withdraw', 'revise', 'cancel'].includes(operation))
      return { approvedVersionId: null, approvedAt: null };
    return {};
  }
  async settings(
    c: DatabaseConnection,
    kind: ExecutionKind,
    subjectId: string,
  ) {
    const current = await this.parameters.read(
      reviewScope(kind, subjectId),
      executionRuleGroup.key,
      c,
    );
    return {
      subjectId,
      kind,
      revision: current?.revision ?? 0,
      values: current?.values ?? { reviewerSelections: [] },
      schemaVersion: 1,
      readMode: 'snapshot',
      fields: reviewRuleFields(this.runtime, kind, executionRuleGroup.key),
    };
  }
  async saveSettings(
    c: DatabaseConnection,
    kind: ExecutionKind,
    subjectId: string,
    raw: unknown,
    version: number,
    actorId: string,
    requestKey: string,
  ) {
    const values = executionRules.parse(raw);
    // Resolve every selection on its own: a good selection cannot hide an invalid one.
    for (const selection of values.reviewerSelections)
      await this.reviewers.resolve(c, subjectId, [selection], []);
    const saved = await this.parameters.save(
      {
        scope: reviewScope(kind, subjectId),
        group: executionRuleGroup,
        values: json(values),
        expectedRevision: version,
        requestId: requestKey,
        actorId,
        at: new Date().toISOString(),
      },
      c,
    );
    return {
      subjectId,
      kind,
      revision: saved.revision,
      values: saved.values,
      schemaVersion: 1,
      readMode: 'snapshot',
    };
  }
}

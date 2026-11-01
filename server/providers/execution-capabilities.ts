import { ApiError } from '@nocobase/app-server/router';
import type { ExecutionRecords } from './execution-records.js';
import type { ExecutionReviewService } from './execution-review-service.js';
import type { ExecutionKind } from './execution-workflow.js';
import type { MaterialPolicies } from './material-service.js';
import {
  executionActor,
  executionText as text,
  executionWrite,
} from './execution-access.js';
import { inventoryError as fail } from './inventory-quantity.js';
import { executionRules } from './execution-workflow.js';

const states: Record<string, readonly string[]> = {
  update: ['draft', 'counting'],
  submit: ['draft', 'counting'],
  approve: ['pending'],
  return: ['pending'],
  withdraw: ['pending'],
  revise: ['approved'],
  cancel: ['draft', 'counting', 'pending', 'approved'],
  reassign: ['pending'],
  copy: ['cancelled'],
  start: ['draft'],
  post: ['draft', 'approved'],
  dispatch: ['approved'],
  receive: ['approved'],
  discrepancy: ['approved'],
  initial: ['draft'],
  loss: ['draft'],
  productionReceipt: ['draft'],
  productionIssue: ['draft'],
  quality: ['draft'],
  reverse: ['draft', 'posted'],
};
const controlled = new Set([
  'productionReceipt',
  'productionIssue',
  'loss',
  'transferDiscrepancy',
]);
/** Read-only hints. Every mutation independently repeats its actual guards. */
export async function executionCapabilities(
  records: ExecutionRecords,
  reviews: ExecutionReviewService,
  kind: ExecutionKind,
  id: string,
  actorId: string,
  p: MaterialPolicies,
  decisions: Record<string, MaterialPolicies | null>,
) {
  const c = records.db.connection(),
    head = await records.head(c, kind, id, p),
    actions: Record<
      string,
      { visible: boolean; enabled: boolean; reason?: string }
    > = {};
  await executionActor(c, records.users, actorId);
  for (const [action, permission] of Object.entries(decisions)) {
    if (!permission) {
      actions[action] = { visible: false, enabled: false };
      continue;
    }
    try {
      await records.head(c, kind, id, permission);
      await executionWrite(
        c,
        kind,
        { updatedBy: actorId },
        permission,
        action === 'copy' ? 'create' : 'update',
        action === 'copy' ? undefined : id,
      );
      actions[action] = {
        visible: true,
        enabled: false,
        reason: 'STOCK_ACTION_UNAVAILABLE',
      };
      if (!states[action]?.includes(text(head.status))) continue;
      if (
        kind === 'stockCounts' &&
        action === 'submit' &&
        head.status !== 'counting'
      )
        continue;
      if (kind === 'stockDocuments') {
        if (
          [
            'submit',
            'approve',
            'return',
            'withdraw',
            'reassign',
            'revise',
          ].includes(action) &&
          !controlled.has(text(head.kind))
        )
          continue;
        if (
          action === 'post' &&
          (controlled.has(text(head.kind))
            ? head.status !== 'approved'
            : head.status !== 'draft')
        )
          continue;
      }
      if (
        action === 'withdraw' &&
        head.createdBy !== actorId &&
        head.submittedBy !== actorId
      )
        returnUnavailable();
      if (
        ['approve', 'return'].includes(action) &&
        !(await reviews.canReview(c, kind, head, actorId))
      )
        returnUnavailable();
      if (action === 'submit') {
        // The parameter store opens its own transaction, so this read cannot
        // reuse the request connection.
        const settings = await records.db.transaction((tx) =>
          reviews.settings(tx, kind, text(head.subjectId)),
        );
        if (!executionRules.safeParse(settings.values).success)
          return fail('STOCK_REVIEW_NOT_CONFIGURED');
      }
      if (action === 'reassign' && head.status === 'pending') {
        const task = await c.repository('executionReviewTasks').findOne({
          filter: {
            kind,
            documentId: id,
            status: 'pending',
            round: Number(head.reviewRound),
          },
        });
        if (!task) returnUnavailable();
        for (const candidate of task.candidates as string[])
          if (
            await reviews.reviewers.eligible(
              c,
              candidate,
              text(head.subjectId),
              task.excludedActors as string[],
            )
          )
            return fail('STOCK_REVIEWERS_STILL_AVAILABLE');
      }
      actions[action] = { visible: true, enabled: true };
    } catch (error) {
      if (error instanceof ApiError)
        actions[action] = {
          visible: error.code !== 404,
          enabled: false,
          reason: error.reason,
        };
      else throw error;
    }
  }
  return {
    recordRevision: Number(head.revision),
    lifecycleVersion: Number(head.lifecycleVersion),
    actions,
  };
  function returnUnavailable(): never {
    return fail('STOCK_ACTION_UNAVAILABLE');
  }
}

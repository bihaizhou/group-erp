import {
  defineLifecycle,
  normalizeReviewerSelections,
  type JsonObject,
  type LifecycleRecord,
  type ParameterGroup,
  type TransitionContext,
} from '@nocobase/lifecycle';
import { z } from 'zod';

export const issueParameterCollections = {
  heads: 'supplyChainParameterHeads',
  versions: 'supplyChainParameterVersions',
  selections: 'supplyChainParameterSelections',
  requests: 'supplyChainParameterRequests',
  snapshots: 'supplyChainParameterSnapshots',
  usages: 'supplyChainParameterUsages',
};
export const issueRuleDefaults = {
  reviewerSelections: [],
  allowParallelGovernance: true,
  requireProject: false,
};
export const issueRuleGroup: ParameterGroup = {
  key: 'issueReview',
  title: 'Issue review',
  schemaVersion: 1,
  fields: {
    reviewerSelections: {
      type: 'reviewers',
      title: 'Review positions or accounts',
      bindings: [{ transition: 'submit' }],
      // No configuration is a valid draft default, never a default approver.
      // Saves reject empty rules; formal submission rejects zero candidates.
      parse: (v) =>
        Array.isArray(v) && v.length === 0
          ? []
          : normalizeReviewerSelections(v, ['position', 'user']),
    },
    allowParallelGovernance: {
      type: 'boolean',
      title: 'Allow review alongside material governance',
      parse: (v) => z.boolean().parse(v),
    },
    requireProject: {
      type: 'boolean',
      title: 'Require project',
      parse: (v) => z.literal(false).parse(v),
    },
  },
};
export interface IssueWorkflowTypes {
  record: LifecycleRecord;
  state: string;
  parameters: {
    reviewerSelections: unknown[];
    allowParallelGovernance: boolean;
    requireProject: boolean;
  };
  services: {
    prepare(
      context: TransitionContext<IssueWorkflowTypes>,
      operation: string,
    ): Promise<JsonObject>;
  };
}
const transition = (
  from: string | string[],
  to: string,
  operation: string,
) => ({
  from,
  to,
  set: async (context: TransitionContext<IssueWorkflowTypes>) => ({
    ...(await context.services.prepare(context, operation)),
    revision: Number(context.record.revision) + 1,
    updatedAt: new Date(),
    updatedBy: context.actor.id,
  }),
});
export const issueLifecycle = defineLifecycle<IssueWorkflowTypes>({
  name: 'materialIssueRequests',
  collection: 'materialIssueRequests',
  initial: 'draft',
  states: ['draft', 'pending', 'approved', { name: 'cancelled', final: true }],
  parameters: issueRuleDefaults,
  parameterConfiguration: {
    readMode: 'snapshot',
    snapshotTransition: 'submit',
    groups: [issueRuleGroup],
  },
  create: { guard: ({ values, actor }) => values.createdBy === actor.id },
  transitions: {
    edit: { ...transition('draft', 'draft', 'edit'), manual: false },
    sourceDraft: {
      ...transition('draft', 'draft', 'sourceDraft'),
      manual: false,
    },
    sourcePending: {
      ...transition('pending', 'pending', 'sourcePending'),
      manual: false,
    },
    sourceApproved: {
      ...transition('approved', 'approved', 'sourceApproved'),
      manual: false,
    },
    confirmMaterial: {
      ...transition(
        ['draft', 'pending', 'approved'],
        'draft',
        'confirmMaterial',
      ),
      manual: false,
    },
    submit: transition('draft', 'pending', 'submit'),
    approve: transition('pending', 'approved', 'approve'),
    return: transition('pending', 'draft', 'return'),
    withdraw: transition('pending', 'draft', 'withdraw'),
    revise: transition('approved', 'draft', 'revise'),
    cancel: transition(['draft', 'pending', 'approved'], 'cancelled', 'cancel'),
    reassign: transition('pending', 'pending', 'reassign'),
  },
});

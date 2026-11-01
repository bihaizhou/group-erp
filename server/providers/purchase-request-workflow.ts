import {
  defineLifecycle,
  normalizeReviewerSelections,
  type JsonObject,
  type LifecycleRecord,
  type ParameterGroup,
  type TransitionContext,
} from '@nocobase/lifecycle';
import { z } from 'zod';

export const purchaseParameterCollections = {
  heads: 'supplyChainParameterHeads',
  versions: 'supplyChainParameterVersions',
  selections: 'supplyChainParameterSelections',
  requests: 'supplyChainParameterRequests',
  snapshots: 'supplyChainParameterSnapshots',
  usages: 'supplyChainParameterUsages',
};
export const purchaseRuleDefaults = {
  reviewerSelections: [],
  allowParallelGovernance: true,
  requireProject: false,
};
export const purchaseRuleGroup: ParameterGroup = {
  key: 'purchaseReview',
  title: 'Purchase review',
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
export interface PurchaseWorkflowTypes {
  record: LifecycleRecord;
  state: string;
  parameters: {
    reviewerSelections: unknown[];
    allowParallelGovernance: boolean;
    requireProject: boolean;
  };
  services: {
    prepare(
      context: TransitionContext<PurchaseWorkflowTypes>,
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
  set: async (context: TransitionContext<PurchaseWorkflowTypes>) => ({
    ...(await context.services.prepare(context, operation)),
    revision: Number(context.record.revision) + 1,
    updatedAt: new Date(),
    updatedBy: context.actor.id,
  }),
});
export const purchaseLifecycle = defineLifecycle<PurchaseWorkflowTypes>({
  name: 'purchaseRequests',
  collection: 'purchaseRequests',
  initial: 'draft',
  states: ['draft', 'pending', 'approved', { name: 'cancelled', final: true }],
  parameters: purchaseRuleDefaults,
  parameterConfiguration: {
    readMode: 'snapshot',
    snapshotTransition: 'submit',
    groups: [purchaseRuleGroup],
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

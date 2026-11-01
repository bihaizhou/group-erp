import {
  defineLifecycle,
  normalizeReviewerSelections,
  type JsonObject,
  type LifecycleRecord,
  type ParameterGroup,
  type TransitionContext,
} from '@nocobase/lifecycle';
import { z } from 'zod';

export const executionKinds = [
  'purchaseOrders',
  'salesOrders',
  'stockDocuments',
  'stockTransfers',
  'stockCounts',
] as const;
export type ExecutionKind = (typeof executionKinds)[number];
export const executionParentField = {
  purchaseOrders: 'purchaseOrderId',
  salesOrders: 'salesOrderId',
  stockDocuments: 'stockDocumentId',
  stockTransfers: 'transferId',
  stockCounts: 'countId',
} as const;
export const executionRuleDefaults = { reviewerSelections: [] };
export const executionRuleGroup: ParameterGroup = {
  key: 'executionReview',
  title: 'Execution approval',
  schemaVersion: 1,
  fields: {
    reviewerSelections: {
      type: 'reviewers',
      title: 'Independent review positions or accounts',
      bindings: [{ transition: 'submit' }],
      parse: (value) =>
        Array.isArray(value) && value.length === 0
          ? []
          : normalizeReviewerSelections(value, ['position', 'user']),
    },
  },
};
export const executionRules = z.strictObject({
  reviewerSelections: z
    .array(
      z.strictObject({
        group: z.number().int().min(1),
        type: z.enum(['position', 'user']),
        referenceId: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(100),
});
export interface ExecutionWorkflowTypes {
  record: LifecycleRecord;
  state: string;
  parameters: { reviewerSelections: unknown[] };
  services: {
    prepare(
      context: TransitionContext<ExecutionWorkflowTypes>,
      operation: string,
    ): Promise<JsonObject>;
  };
}
export function executionLifecycle(kind: ExecutionKind) {
  const step = (from: string | string[], to: string, operation: string) => ({
    from,
    to,
    set: async (context: TransitionContext<ExecutionWorkflowTypes>) => ({
      ...(await context.services.prepare(context, operation)),
      revision: Number(context.record.revision) + 1,
      updatedBy: context.actor.id,
      updatedAt: new Date(),
    }),
  });
  return defineLifecycle<ExecutionWorkflowTypes>({
    name: kind,
    collection: kind,
    initial: 'draft',
    states: [
      'draft',
      ...(kind === 'stockCounts' ? ['counting'] : []),
      'pending',
      ...(kind === 'stockCounts' ? [] : ['approved']),
      ...(kind === 'stockCounts' || kind === 'stockDocuments'
        ? [{ name: 'posted', final: true }]
        : []),
      { name: 'cancelled', final: true },
    ],
    parameters: executionRuleDefaults,
    parameterConfiguration: {
      readMode: 'snapshot',
      snapshotTransition: 'submit',
      groups: [executionRuleGroup],
    },
    create: { guard: ({ values, actor }) => values.createdBy === actor.id },
    transitions: {
      edit: {
        ...step(
          kind === 'stockCounts' ? 'counting' : 'draft',
          kind === 'stockCounts' ? 'counting' : 'draft',
          'edit',
        ),
        manual: false,
      },
      // Count drafts have their own pre-freeze edit; editing a baseline must not reset it.
      ...(kind === 'stockCounts'
        ? { editDraft: { ...step('draft', 'draft', 'edit'), manual: false } }
        : {}),
      submit: step(
        kind === 'stockCounts' ? 'counting' : 'draft',
        'pending',
        'submit',
      ),
      approve: step(
        'pending',
        kind === 'stockCounts' ? 'posted' : 'approved',
        'approve',
      ),
      return: step(
        'pending',
        kind === 'stockCounts' ? 'counting' : 'draft',
        'return',
      ),
      withdraw: step(
        'pending',
        kind === 'stockCounts' ? 'counting' : 'draft',
        'withdraw',
      ),
      ...(kind === 'stockCounts'
        ? {}
        : { revise: step('approved', 'draft', 'revise') }),
      cancel: step(
        kind === 'stockCounts'
          ? ['draft', 'counting', 'pending']
          : ['draft', 'pending', 'approved'],
        'cancelled',
        'cancel',
      ),
      reassign: step('pending', 'pending', 'reassign'),
      ...(kind === 'stockCounts'
        ? {
            start: {
              ...step('draft', 'counting', 'start'),
              manual: kind === 'stockCounts',
            },
          }
        : {}),
      ...(kind === 'stockDocuments'
        ? {
            post: {
              ...step(['draft', 'approved'], 'posted', 'post'),
              manual: kind === 'stockDocuments',
            },
          }
        : {}),
      ...(kind === 'purchaseOrders' || kind === 'salesOrders'
        ? {
            closeRemainder: {
              ...step('approved', 'approved', 'closeRemainder'),
              manual: kind === 'purchaseOrders' || kind === 'salesOrders',
            },
          }
        : {}),
    },
  });
}

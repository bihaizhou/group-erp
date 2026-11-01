import {
  defineLifecycle,
  type LifecycleRecord,
  type JsonObject,
  type TransitionDefinition,
  type TransitionHookContext,
} from '@nocobase/lifecycle';
import {
  materialKinds,
  materialTables,
  materialWorkflowKinds,
  type MaterialKind,
  type MaterialRow,
  type MaterialActor,
} from './material-model.js';

export interface MaterialLifecycleTypes {
  record: LifecycleRecord & MaterialRow;
  state: string;
  services: {
    allowed(
      record: MaterialRow,
      actor: MaterialActor,
      transition: string,
    ): Promise<boolean>;
    prepare(
      record: MaterialRow,
      input: JsonObject,
      transition: string,
    ): Promise<Record<string, unknown>>;
    transitioned(
      context: TransitionHookContext<MaterialLifecycleTypes>,
    ): Promise<void>;
  };
}
const transition = (from: string | string[], to: string, name: string) => ({
  from,
  to,
  guard: async ({
    record,
    actor,
    services,
  }: {
    record: MaterialLifecycleTypes['record'];
    actor: MaterialActor;
    services: MaterialLifecycleTypes['services'];
  }) =>
    (await services.allowed(record, actor, name)) || {
      code: 'MATERIAL_ACTION_DENIED',
      message: 'This action is unavailable.',
    },
  set: async ({
    record,
    input,
    services,
  }: {
    record: MaterialLifecycleTypes['record'];
    input: JsonObject;
    services: MaterialLifecycleTypes['services'];
  }) => ({
    ...(await services.prepare(record, input, name)),
    revision: Number(record.revision) + 1,
    updatedAt: new Date(),
  }),
  onTransition: async (
    context: TransitionHookContext<MaterialLifecycleTypes>,
  ) => context.services.transitioned(context),
});
export const materialLifecycles = Object.fromEntries(
  materialKinds.map((kind) => {
    const governed = materialWorkflowKinds.includes(kind);
    const states =
      kind === 'requests'
        ? [
            'draft',
            'pending',
            { name: 'resolved', final: true },
            { name: 'withdrawn', final: true },
          ]
        : governed
          ? ['draft', 'pending', 'active', 'inactive']
          : ['active', 'inactive'];
    const transitions: Record<
      string,
      TransitionDefinition<MaterialLifecycleTypes>
    > = kind === 'requests'
      ? {
          edit: { ...transition('draft', 'draft', 'edit'), manual: false },
          invalidateSource: {
            ...transition(
              ['draft', 'pending'],
              'withdrawn',
              'invalidateSource',
            ),
            manual: false,
          },
          submit: transition('draft', 'pending', 'submit'),
          return: transition('pending', 'draft', 'return'),
          resolve: transition('pending', 'resolved', 'resolve'),
          withdraw: transition(['draft', 'pending'], 'withdrawn', 'withdraw'),
        }
      : governed
        ? {
            edit: { ...transition('draft', 'draft', 'edit'), manual: false },
            editActive: {
              ...transition('active', 'active', 'editActive'),
              manual: false,
            },
            submit: transition('draft', 'pending', 'submit'),
            return: transition('pending', 'draft', 'return'),
            approve: transition('pending', 'active', 'approve'),
            deactivate: transition('active', 'inactive', 'deactivate'),
            reactivate: transition('inactive', 'active', 'reactivate'),
          }
        : {
            edit: { ...transition('active', 'active', 'edit'), manual: false },
            editInactive: {
              ...transition('inactive', 'inactive', 'editInactive'),
              manual: false,
            },
            deactivate: transition('active', 'inactive', 'deactivate'),
            reactivate: transition('inactive', 'active', 'reactivate'),
          };
    return [
      kind,
      defineLifecycle<MaterialLifecycleTypes>({
        name: materialTables[kind],
        collection: materialTables[kind],
        initial: governed ? 'draft' : 'active',
        states,
        create: { guard: ({ values, actor }) => values.createdBy === actor.id },
        transitions,
      }),
    ];
  }),
) as Record<
  MaterialKind,
  ReturnType<typeof defineLifecycle<MaterialLifecycleTypes>>
>;

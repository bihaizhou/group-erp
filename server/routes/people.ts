import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
  type AuthorizationContext,
} from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  ApiError,
  apiErrorHandler,
  apiErrorResponse,
  apiErrorResponses,
  apiValidator,
  dataResponse,
  resolver,
  listResponse,
  defineApiRoutes,
  describeRoute,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import {
  LifecycleError,
  ParameterConfigurationError,
  lifecycleErrorFields,
} from '@nocobase/lifecycle';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { peopleServiceToken } from '../providers/people.js';
import {
  peopleKinds,
  peopleTables,
  peopleQuery,
  peopleDataSchemas,
  peopleInputBase,
  PeopleError,
  workflowKinds,
  type PeopleKind,
  type PeopleActor,
} from '../providers/people-model.js';
import type { PeoplePolicies } from '../providers/people-service.js';

const idParam = z.object({ id: z.string().uuid() });
const version = z.number().int().positive();
const reason = z.string().trim().min(1).max(1000);
const output = z.record(z.string(), z.json());
const responses = {
  ...apiErrorResponses,
  '400': apiErrorResponse(400),
  '404': apiErrorResponse(404),
  '409': apiErrorResponse(409),
};
type PeopleEnv = AuthEnv &
  AuthorizationEnv & { Variables: { peoplePolicies: PeoplePolicies } };
async function authorize(
  ctx: AuthorizationContext,
  kind: PeopleKind | 'history',
  action: string,
) {
  const decision = await ctx.authorize({
    resource: { type: 'composite', id: `people.${kind}` },
    action,
  });
  const policies = decision.conditions?.database;
  if (
    decision.effect === 'deny' ||
    !policies ||
    !policies[kind === 'history' ? 'peopleAudit' : peopleTables[kind]]
  )
    throw new ApiError({
      status: 'PERMISSION_DENIED',
      reason: 'PEOPLE_FORBIDDEN',
      domain: 'people',
      message: 'Not permitted.',
    });
  return policies as PeoplePolicies;
}
async function optionalAuthorize(
  ctx: AuthorizationContext,
  kind: PeopleKind | 'history',
  action: string,
) {
  const allowed = await ctx.can({
    resource: { type: 'composite', id: `people.${kind}` },
    action,
  });
  return allowed ? authorize(ctx, kind, action) : null;
}
export const peopleRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const authentication = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const service = app.container.resolve(peopleServiceToken);
    const router = new Hono<PeopleEnv>();
    // Contributions share a router: every middleware is scoped to this feature's paths.
    router.use(
      '/people/*',
      authentication.required(),
      authz.middleware(),
      bodyLimit({
        maxSize: 262144,
        onError: () => {
          throw new ApiError({
            status: 'INVALID_ARGUMENT',
            httpStatus: 413,
            reason: 'BODY_TOO_LARGE',
            domain: 'people',
            message: 'Payload too large.',
          });
        },
      }),
    );
    const actor = (c: {
      get: (key: 'auth') => AuthEnv['Variables']['auth'];
    }): PeopleActor => {
      const { user } = c.get('auth')!;
      return { id: user.id, name: user.name || user.email };
    };
    router.onError((error, c) => {
      if (error instanceof PeopleError)
        return apiErrorHandler(
          new ApiError({
            status:
              error.reason === 'PEOPLE_NOT_FOUND'
                ? 'NOT_FOUND'
                : error.reason === 'PEOPLE_FORBIDDEN' ||
                    error.reason === 'PEOPLE_ACTION_DENIED'
                  ? 'PERMISSION_DENIED'
                  : error.reason === 'PEOPLE_VERSION_CONFLICT'
                    ? 'ABORTED'
                    : error.reason.endsWith('_EXISTS')
                      ? 'ALREADY_EXISTS'
                      : error.field
                        ? 'INVALID_ARGUMENT'
                        : 'FAILED_PRECONDITION',
            reason: error.reason,
            domain: 'people',
            message: error.reason,
            ...(error.field
              ? {
                  fieldViolations: [
                    { field: error.field, description: error.reason },
                  ],
                }
              : {}),
          }),
          c,
        );
      if (error instanceof ParameterConfigurationError)
        return apiErrorHandler(
          new ApiError({
            status:
              error.code === 'CONFIGURATION_CONFLICT' ||
              error.code === 'CONFIGURATION_REQUEST_REUSED'
                ? 'ABORTED'
                : 'INVALID_ARGUMENT',
            reason: `PEOPLE_${error.code}`,
            domain: 'people',
            message: error.message,
          }),
          c,
        );
      if (error instanceof z.ZodError)
        return apiErrorHandler(
          new ApiError({
            status: 'INVALID_ARGUMENT',
            reason: 'PEOPLE_INVALID_INPUT',
            domain: 'people',
            message: 'Invalid input.',
            fieldViolations: error.issues.map((i) => ({
              field: i.path.join('.'),
              description: 'Invalid value.',
            })),
          }),
          c,
        );
      if (error instanceof LifecycleError) {
        const fields = lifecycleErrorFields(error);
        if (fields)
          return apiErrorHandler(
            new ApiError({ ...fields, domain: 'people' }),
            c,
          );
      }
      return apiErrorHandler(error, c);
    });
    router.get(
      '/people/options',
      describeRoute({
        tags: ['People'],
        operationId: 'peopleOptions',
        summary: 'Read scoped people and organization options',
        responses: {
          '200': {
            description: 'Scoped options and group business date',
            content: {
              'application/json': {
                schema: resolver(
                  z.strictObject({
                    data: output,
                    meta: z.strictObject({
                      businessDate: z.string(),
                      timeZone: z.string(),
                    }),
                  }),
                ),
              },
            },
          },
          ...responses,
        },
      }),
      apiValidator('query', z.object({ kind: z.enum(peopleKinds) })),
      async (c) => {
        const kind = c.req.valid('query').kind;
        const policies = await authorize(c.get('authz'), kind, 'read');
        return c.json({
          meta: {
            businessDate: service.businessDate(),
            timeZone: service.timeZone,
          },
          data: await service.options(
            kind,
            policies,
            kind === 'employees' &&
              (await c.get('authz').can({
                resource: {
                  type: 'settings',
                  id: 'personnel.accountBinding',
                },
                action: 'read',
              })),
          ),
        });
      },
    );
    router.get(
      '/people/overview',
      describeRoute({
        tags: ['People'],
        operationId: 'peopleOverview',
        summary: 'Read authorized group talent overview',
        responses: { '200': dataResponse(output), ...responses },
      }),
      async (c) => {
        const policies = await authorize(c.get('authz'), 'profiles', 'read');
        return c.json({ data: await service.overview(policies) });
      },
    );
    router.get(
      '/people/talent/:id',
      describeRoute({
        tags: ['People'],
        operationId: 'peopleTalent',
        summary: 'Read employee talent card',
        responses: { '200': dataResponse(output), ...responses },
      }),
      apiValidator('param', idParam),
      async (c) => {
        const policies = await authorize(c.get('authz'), 'profiles', 'read');
        const result = await service.talent(
          c.req.valid('param').id,
          policies,
          actor(c),
        );
        return c.json({
          data: {
            ...result,
            photoUrl: result.photo
              ? `${app.publicBasePath}/uploads/peoplePhotos/${result.photo.id}${result.photo.ext ? '.' + result.photo.ext : ''}`
              : null,
          },
        });
      },
    );
    router.get(
      '/people/employees/:id/career',
      describeRoute({
        tags: ['People'],
        operationId: 'peopleCareer',
        summary: 'Read employee personnel and talent history',
        responses: { '200': dataResponse(output), ...responses },
      }),
      apiValidator('param', idParam),
      async (c) => {
        const authorization = c.get('authz');
        const policies: PeoplePolicies = {
          ...(await authorize(authorization, 'employees', 'read')),
        };
        for (const kind of [
          'employments',
          'assignments',
          'changes',
          'history',
        ] as const) {
          const extra = await optionalAuthorize(authorization, kind, 'read');
          if (!extra) continue;
          for (const [table, policy] of Object.entries(extra))
            if (!(table in policies)) policies[table] = policy;
        }
        return c.json({
          data: await service.career(c.req.valid('param').id, policies),
        });
      },
    );
    router.get(
      '/people/history',
      describeRoute({
        tags: ['People'],
        operationId: 'peopleHistory',
        summary: 'Read scoped personnel and talent audit',
        responses: { '200': listResponse(output), ...responses },
      }),
      apiValidator('query', peopleQuery),
      async (c) =>
        c.json(
          await service.history(
            c.req.valid('query'),
            await authorize(c.get('authz'), 'history', 'read'),
          ),
        ),
    );
    router.get(
      '/people/access',
      describeRoute({
        tags: ['People'],
        operationId: 'peopleAccess',
        summary: 'Read feature action eligibility',
        responses: { '200': dataResponse(output), ...responses },
      }),
      async (c) => {
        const actions: Record<string, Record<string, boolean>> = {};
        for (const kind of peopleKinds) {
          actions[kind] = {};
          for (const action of [
            ...['read', 'update', 'review'],
            ...(kind === 'workforcePlans' ? ['companyConfirm'] : []),
          ])
            actions[kind][action] = await c.get('authz').can({
              resource: { type: 'composite', id: `people.${kind}` },
              action,
            });
        }
        return c.json({ data: actions });
      },
    );
    router.get(
      '/people/approvals/todo',
      describeRoute({
        tags: ['People'],
        operationId: 'peopleApprovalTodo',
        summary: 'Read personnel changes waiting on the viewer',
        responses: { '200': listResponse(output), ...responses },
      }),
      async (c) =>
        c.json(
          await service.approvalTodo(
            actor(c),
            await authorize(c.get('authz'), 'changes', 'read'),
          ),
        ),
    );
    router.get(
      '/people/approval-settings',
      describeRoute({
        tags: ['People'],
        operationId: 'peopleApprovalSettings',
        summary: 'Read the personnel approval chains',
        responses: { '200': dataResponse(output), ...responses },
      }),
      async (c) => {
        await authorize(c.get('authz'), 'changes', 'read');
        return c.json({ data: await service.approvalSettings() });
      },
    );
    router.put(
      '/people/approval-settings',
      describeRoute({
        tags: ['People'],
        operationId: 'peopleSaveApprovalSettings',
        summary: 'Replace the personnel approval chains',
        responses: { '200': dataResponse(output), ...responses },
      }),
      apiValidator(
        'json',
        z.strictObject({
          values: z.record(z.string(), z.json()),
          // A fresh installation starts at revision 0.
          version: z.number().int().nonnegative(),
          requestId: z.string().min(1).max(200),
        }),
      ),
      async (c) => {
        await authorize(c.get('authz'), 'changes', 'update');
        return c.json({
          data: await service.saveApprovalSettings(
            c.req.valid('json'),
            actor(c),
          ),
        });
      },
    );
    for (const kind of peopleKinds) {
      const access =
        (action: string) =>
        async (
          c: import('hono').Context<PeopleEnv>,
          next: () => Promise<void>,
        ) => {
          c.set(
            'peoplePolicies',
            await authorize(c.get('authz'), kind, action),
          );
          await next();
        };
      const schema = z.strictObject({
        ...peopleInputBase,
        data: peopleDataSchemas[kind],
      });
      router.get(
        `/people/${kind}`,
        access('read'),
        describeRoute({
          tags: ['People'],
          operationId: `peopleList${kind}`,
          summary: `List ${kind}`,
          responses: { '200': listResponse(output), ...responses },
        }),
        apiValidator('query', peopleQuery),
        async (c) =>
          c.json(
            await service.list(
              kind,
              c.req.valid('query'),
              c.get('peoplePolicies'),
            ),
          ),
      );
      router.get(
        `/people/${kind}/:id`,
        access('read'),
        describeRoute({
          tags: ['People'],
          operationId: `peopleGet${kind}`,
          summary: `Read ${kind}`,
          responses: { '200': dataResponse(output), ...responses },
        }),
        apiValidator('param', idParam),
        async (c) => {
          const who = actor(c);
          who.companyReview =
            kind === 'workforcePlans' &&
            (await c.get('authz').can({
              resource: { type: 'composite', id: 'people.workforcePlans' },
              action: 'companyConfirm',
            }));
          who.review = await c.get('authz').can({
            resource: { type: 'composite', id: `people.${kind}` },
            action: 'review',
          });
          return c.json({
            data: await service.get(
              kind,
              c.req.valid('param').id,
              c.get('peoplePolicies'),
              who,
            ),
          });
        },
      );
      if (!['employments', 'assignments'].includes(kind)) {
        router.post(
          `/people/${kind}`,
          access('update'),
          describeRoute({
            tags: ['People'],
            operationId: `peopleCreate${kind}`,
            summary: `Create ${kind}`,
            responses: { '201': dataResponse(output), ...responses },
          }),
          apiValidator('json', schema),
          async (c) =>
            c.json(
              {
                data: await service.save(
                  kind,
                  c.req.valid('json'),
                  {
                    ...actor(c),
                    bindAccounts: await c.get('authz').can({
                      resource: {
                        type: 'settings',
                        id: 'personnel.accountBinding',
                      },
                      action: 'update',
                    }),
                  },
                  c.get('peoplePolicies'),
                ),
              },
              201,
            ),
        );
        router.patch(
          `/people/${kind}/:id`,
          access('update'),
          describeRoute({
            tags: ['People'],
            operationId: `peopleUpdate${kind}`,
            summary: `Edit draft ${kind}`,
            responses: { '200': dataResponse(output), ...responses },
          }),
          apiValidator('param', idParam),
          apiValidator(
            'json',
            z.strictObject({
              code: peopleInputBase.code.optional(),
              name: peopleInputBase.name.optional(),
              subjectId: z.string().uuid().nullable().optional(),
              personId: z.string().uuid().nullable().optional(),
              positionId: z.string().uuid().nullable().optional(),
              data: peopleDataSchemas[kind].optional(),
              version,
              reason,
            }),
          ),
          async (c) =>
            c.json({
              data: await service.save(
                kind,
                c.req.valid('json'),
                {
                  ...actor(c),
                  bindAccounts: await c.get('authz').can({
                    resource: {
                      type: 'settings',
                      id: 'personnel.accountBinding',
                    },
                    action: 'update',
                  }),
                },
                c.get('peoplePolicies'),
                c.req.valid('param').id,
              ),
            }),
        );
      }
      if (workflowKinds.includes(kind))
        router.post(
          `/people/${kind}/:id/fire`,
          async (c, next) => {
            // Decide authorization from the action before validating the business payload.
            const raw = await c.req.json<unknown>().catch(() => null);
            const body =
              raw && typeof raw === 'object'
                ? (raw as Record<string, unknown>)
                : {};
            const transition =
              typeof body.transition === 'string' ? body.transition : '';
            const action =
              kind === 'changes' &&
              ['approve', 'return', 'withdraw'].includes(transition)
                ? 'read'
                : transition === 'companyConfirm'
                  ? 'companyConfirm'
                  : ['approve', 'confirm', 'return', 'companyConfirm'].includes(
                        transition,
                      )
                    ? 'review'
                    : 'update';
            c.set(
              'peoplePolicies',
              await authorize(c.get('authz'), kind, action),
            );
            await next();
          },
          describeRoute({
            tags: ['People'],
            operationId: `peopleFire${kind}`,
            summary: `Advance ${kind} workflow`,
            responses: { '200': dataResponse(output), ...responses },
          }),
          apiValidator('param', idParam),
          apiValidator(
            'json',
            z.strictObject({
              transition: z.string().min(1).max(64),
              version,
              requestId: z.string().min(1).max(200),
              reason,
              input: z.record(z.string(), z.json()).optional(),
            }),
          ),
          async (c) => {
            const who = actor(c);
            who.companyReview =
              kind === 'workforcePlans' &&
              (await c.get('authz').can({
                resource: { type: 'composite', id: 'people.workforcePlans' },
                action: 'companyConfirm',
              }));
            who.review = await c.get('authz').can({
              resource: { type: 'composite', id: `people.${kind}` },
              action: 'review',
            });
            const body = c.req.valid('json');
            return c.json({
              data:
                kind === 'changes' && body.transition === 'approve'
                  ? await service.decide(
                      kind,
                      c.req.valid('param').id,
                      body,
                      who,
                      c.get('peoplePolicies'),
                    )
                  : await service.fire(
                      kind,
                      c.req.valid('param').id,
                      body,
                      who,
                      c.get('peoplePolicies'),
                    ),
            });
          },
        );
    }
    router.get(
      '/people/employees/:id/contacts',
      async (c, next) => {
        await c.get('authz').require({
          resource: { type: 'settings', id: 'personnel.sensitive' },
          action: 'read',
        });
        c.set(
          'peoplePolicies',
          await authorize(c.get('authz'), 'employees', 'read'),
        );
        await next();
      },
      describeRoute({
        tags: ['People'],
        operationId: 'peopleGetContacts',
        summary: 'Read separately authorized contact details',
        responses: { '200': dataResponse(output), ...responses },
      }),
      apiValidator('param', idParam),
      async (c) =>
        c.json({
          data: await service.contacts(
            c.req.valid('param').id,
            c.get('peoplePolicies'),
          ),
        }),
    );
    router.put(
      '/people/employees/:id/contacts',
      async (c, next) => {
        await c.get('authz').require({
          resource: { type: 'settings', id: 'personnel.sensitive' },
          action: 'update',
        });
        c.set(
          'peoplePolicies',
          await authorize(c.get('authz'), 'employees', 'update'),
        );
        await next();
      },
      describeRoute({
        tags: ['People'],
        operationId: 'peopleSaveContacts',
        summary: 'Update separately authorized contact details',
        responses: { '200': dataResponse(output), ...responses },
      }),
      apiValidator('param', idParam),
      apiValidator(
        'json',
        z.strictObject({
          phone: z.string().trim().max(100),
          email: z.union([z.literal(''), z.email().max(200)]),
        }),
      ),
      async (c) =>
        c.json({
          data: await service.contacts(
            c.req.valid('param').id,
            c.get('peoplePolicies'),
            c.req.valid('json'),
            actor(c),
          ),
        }),
    );
    const root = new Hono();
    root.route('/', router);
    return root;
  });

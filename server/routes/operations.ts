import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  ApiError,
  apiErrorHandler,
  apiErrorResponse,
  apiErrorResponses,
  apiValidator,
  dataResponse,
  defineApiRoutes,
  describeRoute,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import {
  operationsCompanyQuery,
  operationsIssueInput,
  operationsIssueQuery,
  operationsIssueUpdate,
  operationsOverviewQuery,
  operationsTargetInput,
  operationsTargetQuery,
} from '../providers/operations-model.js';
import { peopleTables } from '../providers/people-model.js';
import {
  OperationsError,
  type OperationsScope,
  operationsServiceToken,
} from '../providers/operations-service.js';

type Env = AuthEnv & AuthorizationEnv;
const object = z.record(z.string(), z.unknown());
const issueIdParams = z.object({ id: z.string().length(36) });
const errors = {
  ...apiErrorResponses,
  '400': apiErrorResponse(400),
  '403': apiErrorResponse(403),
};

function toApiError(error: OperationsError) {
  return new ApiError({
    status:
      error.code === 'OPERATIONS_FORBIDDEN'
        ? 'PERMISSION_DENIED'
        : 'INVALID_ARGUMENT',
    domain: 'operations',
    reason: error.code,
    message: error.message,
  });
}

type CompositeSource = 'warehouse' | 'sales' | 'procurement' | 'people';

/** A database read policy that permits every record (no record-level scope). */
function unrestrictedReadPolicy(read: unknown): boolean {
  if (read === true) return true;
  if (read && typeof read === 'object') {
    return (read as { scope?: unknown }).scope === true;
  }
  return false;
}

/**
 * Whether a composite source module is granted for the operations overview.
 *
 * Mirrors the guards the source modules apply to their own endpoints
 * (`server/routes/inventory.ts` `allowed()`, `server/routes/trade-orders.ts`
 * `allowed()`, `server/routes/people.ts` `authorize()`): a denied decision,
 * or one without database conditions, is never granted, and people
 * additionally requires a policy for `personnelEmployees`
 * (`peopleTables.employees`).
 *
 * The overview aggregates the source tables directly and cannot apply
 * record-level conditions, so this goes one step further than the literal
 * guards: every underlying read policy must be unrestricted (permit every
 * record). A record-limited grant (conditional scopes) or a bare grant (all
 * reads false) therefore masks the block instead of leaking whole-module
 * aggregates — composed database conditions are always present and truthy
 * for non-denied composite decisions, so presence alone cannot tell the
 * two apart.
 */
export function compositeSourceGranted(
  source: CompositeSource,
  decision: {
    effect: string;
    conditions?: { database?: unknown };
  },
): boolean {
  if (decision.effect === 'deny') return false;
  const database = decision.conditions?.database as
    | Record<string, { read?: unknown }>
    | undefined;
  if (!database) return false;
  if (source === 'people' && !database[peopleTables.employees]) return false;
  return Object.values(database).every((policy) =>
    unrestrictedReadPolicy(policy.read),
  );
}

export const operationsRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const service = app.container.resolve(operationsServiceToken);
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const router = new Hono<Env>();
    for (const path of [
      '/overview',
      '/company-overview',
      '/companies',
      '/options',
      '/issues',
      '/issues/:id',
      '/targets',
    ])
      router.use(path, auth.required(), authz.middleware());
    const actor = (c: Context<Env>) => ({
      type: 'user',
      id: c.get('auth')!.user.id,
    });
    const scoped = async (c: Context<Env>): Promise<OperationsScope> => {
      const context = c.get('authz');
      const granted = async (
        resource: { type: string; id: string },
        action: string,
      ) =>
        (await context.authorize({ resource, action })).effect !== 'deny';
      const grantedComposite = async (
        source: CompositeSource,
        resource: { type: 'composite'; id: string },
        action: string,
      ) =>
        compositeSourceGranted(
          source,
          await context.authorize({ resource, action }),
        );
      return {
        readAll:
          (
            await context.authorize({
              resource: { type: 'settings', id: 'operations' },
              action: 'readAll',
            })
          ).effect !== 'deny',
        sources: {
          hse: await granted({ type: 'settings', id: 'hse' }, 'read'),
          production: await granted(
            { type: 'settings', id: 'production' },
            'read',
          ),
          warehouse: await grantedComposite(
            'warehouse',
            { type: 'composite', id: 'warehouse.inventory' },
            'read',
          ),
          sales: await grantedComposite(
            'sales',
            { type: 'composite', id: 'sales.orders' },
            'read',
          ),
          procurement: await grantedComposite(
            'procurement',
            { type: 'composite', id: 'procurement.orders' },
            'read',
          ),
          people: await grantedComposite(
            'people',
            { type: 'composite', id: 'people.employees' },
            'read',
          ),
        },
      };
    };
    const allowed = createMiddleware<Env>(async (c, next) => {
      const result = await c.get('authz').authorize({
        resource: { type: 'settings', id: 'operations' },
        action: 'read',
      });
      if (result.effect === 'deny')
        throw new OperationsError('OPERATIONS_FORBIDDEN', 'PERMISSION_DENIED');
      await next();
    });
    const canManage = createMiddleware<Env>(async (c, next) => {
      const result = await c.get('authz').authorize({
        resource: { type: 'settings', id: 'operations' },
        action: 'manage',
      });
      if (result.effect === 'deny')
        throw new OperationsError('OPERATIONS_FORBIDDEN', 'PERMISSION_DENIED');
      await next();
    });
    const describe = (operationId: string, summary: string) =>
      describeRoute({
        operationId,
        summary,
        tags: ['Operations'],
        responses: { '200': dataResponse(object), ...errors },
      });
    router.onError((error, c) => {
      if (error instanceof OperationsError)
        return apiErrorHandler(toApiError(error), c);
      return apiErrorHandler(error, c);
    });

    router.get(
      '/options',
      allowed,
      describe('operationsOptions', 'Read companies in the operations scope'),
      async (c) =>
        c.json({ data: await service.options(actor(c), await scoped(c)) }),
    );

    router.get(
      '/companies',
      allowed,
      describe('operationsCompanies', 'List companies in the operations scope'),
      apiValidator('query', operationsCompanyQuery),
      async (c) =>
        c.json(
          await service.companies(
            actor(c),
            c.req.valid('query'),
            await scoped(c),
          ),
        ),
    );

    router.get(
      '/overview',
      allowed,
      describe(
        'operationsOverview',
        'Read daily production, inventory and HSE overview',
      ),
      apiValidator('query', operationsOverviewQuery),
      async (c) =>
        c.json({
          data: await service.overview(
            actor(c),
            c.req.valid('query'),
            await scoped(c),
          ),
        }),
    );

    router.get(
      '/company-overview',
      allowed,
      describe(
        'operationsCompanyOverview',
        'Read one daily overview per authorized company',
      ),
      apiValidator('query', operationsOverviewQuery),
      async (c) =>
        c.json({
          data: await service.companyOverview(
            actor(c),
            c.req.valid('query'),
            await scoped(c),
          ),
        }),
    );

    router.get(
      '/issues',
      allowed,
      describe('operationsIssueList', 'List operations issues'),
      apiValidator('query', operationsIssueQuery),
      async (c) =>
        c.json({
          data: await service.listIssues(
            actor(c),
            c.req.valid('query'),
            await scoped(c),
          ),
        }),
    );

    router.get(
      '/targets',
      allowed,
      describe('operationsTargetList', 'List monthly KPI targets'),
      apiValidator('query', operationsTargetQuery),
      async (c) =>
        c.json({
          data: await service.listTargets(
            actor(c),
            c.req.valid('query'),
            await scoped(c),
          ),
        }),
    );

    router.put(
      '/targets',
      canManage,
      describe('operationsTargetSave', 'Save a monthly KPI target'),
      apiValidator('json', operationsTargetInput),
      async (c) =>
        c.json({
          data: await service.saveTarget(
            actor(c),
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/issues',
      canManage,
      describe('operationsIssueCreate', 'Create an operations issue'),
      apiValidator('json', operationsIssueInput),
      async (c) =>
        c.json(
          {
            data: await service.createIssue(
              actor(c),
              c.req.valid('json'),
              await scoped(c),
            ),
          },
          201,
        ),
    );

    router.patch(
      '/issues/:id',
      canManage,
      describe('operationsIssueUpdate', 'Update an operations issue'),
      apiValidator('param', issueIdParams),
      apiValidator('json', operationsIssueUpdate),
      async (c) =>
        c.json({
          data: await service.updateIssue(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    const root = new Hono();
    root.route('/operations', router);
    return root;
  });

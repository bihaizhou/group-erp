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
  operationsIssueInput,
  operationsIssueQuery,
  operationsIssueUpdate,
  operationsOverviewQuery,
  operationsTargetInput,
  operationsTargetQuery,
} from '../providers/operations-model.js';
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

export const operationsRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const service = app.container.resolve(operationsServiceToken);
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const router = new Hono<Env>();
    for (const path of [
      '/overview',
      '/company-overview',
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
    const scoped = async (c: Context<Env>): Promise<OperationsScope> => ({
      readAll:
        (
          await c.get('authz').authorize({
            resource: { type: 'settings', id: 'operations' },
            action: 'readAll',
          })
        ).effect !== 'deny',
    });
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

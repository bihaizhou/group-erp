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
  listResponse,
  defineApiRoutes,
  describeRoute,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import {
  assetAssign,
  assetCreate,
  assetIdParams,
  assetQuery,
  assetReturn,
  assetScrap,
  assetUpdate,
} from '../providers/asset-model.js';
import {
  AssetError,
  assetServiceToken,
  type AssetScope,
} from '../providers/asset-service.js';

type Env = AuthEnv & AuthorizationEnv;
const errors = {
  ...apiErrorResponses,
  '400': apiErrorResponse(400),
  '403': apiErrorResponse(403),
  '404': apiErrorResponse(404),
  '409': apiErrorResponse(409),
};
const object = z.record(z.string(), z.unknown());
const pageMeta = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});

function toApiError(error: AssetError) {
  const status =
    error.code === 'ASSET_FORBIDDEN'
      ? 'PERMISSION_DENIED'
      : error.code === 'ASSET_NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'ASSET_CONFLICT'
          ? 'ABORTED'
          : 'INVALID_ARGUMENT';
  return new ApiError({
    status,
    domain: 'assets',
    reason: error.code,
    message: error.message,
  });
}

export const assetRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const service = app.container.resolve(assetServiceToken),
      auth = app.container.resolve(authenticationToken),
      authz = app.container.resolve(authorizationToken),
      router = new Hono<Env>();
    router.use('*', auth.required(), authz.middleware());
    const actor = (c: Context<Env>) => ({
      type: 'user',
      id: c.get('auth')!.user.id,
    });
    const scoped = async (c: Context<Env>): Promise<AssetScope> => {
      const context = c.get('authz');
      const result = async (action: string) =>
        (
          await context.authorize({
            resource: { type: 'settings', id: 'assets' },
            action,
          })
        ).effect !== 'deny';
      return {
        readAll: await result('readAll'),
        manage: await result('manage'),
      };
    };
    const allowed = (action: 'read' | 'manage' | 'readAll') =>
      createMiddleware<Env>(async (c, next) => {
        const result = await c.get('authz').authorize({
          resource: { type: 'settings', id: 'assets' },
          action,
        });
        if (result.effect === 'deny')
          throw new AssetError('ASSET_FORBIDDEN', 'PERMISSION_DENIED');
        await next();
      });
    const describe = (
      operationId: string,
      summary: string,
      response: ReturnType<typeof dataResponse>,
      ok = 200,
    ) =>
      describeRoute({
        operationId,
        summary,
        tags: ['Assets'],
        responses: { [String(ok)]: response, ...errors },
      });
    router.onError((error, c) => {
      if (error instanceof AssetError)
        return apiErrorHandler(toApiError(error), c);
      return apiErrorHandler(error, c);
    });

    router.get(
      '/options',
      allowed('read'),
      describe(
        'assetOptions',
        'Read companies, employees and categories available for assets',
        dataResponse(object),
      ),
      async (c) =>
        c.json({ data: await service.options(actor(c), await scoped(c)) }),
    );

    router.get(
      '/',
      allowed('read'),
      describe(
        'assetList',
        'List fixed assets',
        listResponse(object, pageMeta),
      ),
      apiValidator('query', assetQuery),
      async (c) => {
        const result = await service.list(
          actor(c),
          c.req.valid('query'),
          await scoped(c),
        );
        return c.json({
          data: result.rows,
          meta: {
            page: result.page,
            pageSize: result.pageSize,
            total: result.total,
          },
        });
      },
    );

    router.get(
      '/:id',
      allowed('read'),
      describe(
        'assetDetail',
        'Read one fixed asset and its events',
        dataResponse(object),
      ),
      apiValidator('param', assetIdParams),
      async (c) =>
        c.json({
          data: await service.detail(
            actor(c),
            c.req.valid('param').id,
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/',
      allowed('manage'),
      describe(
        'assetCreate',
        'Create a fixed asset',
        dataResponse(object),
        201,
      ),
      apiValidator('json', assetCreate),
      async (c) =>
        c.json(
          {
            data: await service.create(
              actor(c),
              c.req.valid('json'),
              await scoped(c),
            ),
          },
          201,
        ),
    );

    router.patch(
      '/:id',
      allowed('manage'),
      describe(
        'assetUpdate',
        'Update fixed asset metadata',
        dataResponse(object),
      ),
      apiValidator('param', assetIdParams),
      apiValidator('json', assetUpdate),
      async (c) =>
        c.json({
          data: await service.update(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    for (const [action, schema] of [
      ['assign', assetAssign],
      ['return', assetReturn],
      ['scrap', assetScrap],
    ] as const) {
      router.post(
        `/:id/${action}`,
        allowed('manage'),
        describe(
          `asset${action[0].toUpperCase()}${action.slice(1)}`,
          `${action} a fixed asset`,
          dataResponse(object),
        ),
        apiValidator('param', assetIdParams),
        apiValidator('json', schema),
        async (c) => {
          const id = c.req.valid('param').id;
          const input = c.req.valid('json');
          const scope = await scoped(c);
          const data =
            action === 'assign'
              ? await service.assign(actor(c), id, input as never, scope)
              : action === 'return'
                ? await service.returnAsset(actor(c), id, input as never, scope)
                : await service.scrap(actor(c), id, input as never, scope);
          return c.json({ data });
        },
      );
    }

    const root = new Hono();
    root.route('/assets', router);
    return root;
  });

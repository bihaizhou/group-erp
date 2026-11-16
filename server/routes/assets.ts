import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import { databaseManagerToken } from '@nocobase/db';
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
  assetBatchAssign,
  assetBatchReturn,
  assetCreate,
  assetCompanyQuery,
  assetIdParams,
  assetQuery,
  assetReturn,
  assetScrapDecision,
  assetScrapRequest,
  assetUpdate,
  type AssetAssign,
} from '../providers/asset-model.js';
import {
  AssetError,
  assetServiceToken,
  type AssetScope,
} from '../providers/asset-service.js';
import {
  assertFieldsWritable,
  fieldPoliciesFor,
  redactRecord,
  redactRows,
} from '../providers/field-access.js';
import { resourceFieldNames } from '../providers/field-catalog.js';

type Env = AuthEnv & AuthorizationEnv;
/** Field-policy resource covering the fixed-asset catalog fields. */
const ASSET_RESOURCE = 'people.assets';
/** Null and the empty string both mean "not provided" on an asset form. */
const isProvided = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== '';
/** Compare a date by its calendar day; everything else as text. */
const asComparable = (field: string, value: unknown): string | null => {
  if (value === '' || value === null || value === undefined) return null;
  const text = String(value);
  return field === 'acquiredOn' && text.length >= 10 ? text.slice(0, 10) : text;
};
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
      db = app.container.resolve(databaseManagerToken),
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
        approve: await result('approve'),
      };
    };
    const allowed = (action: 'read' | 'manage' | 'readAll' | 'approve') =>
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
      '/companies',
      allowed('read'),
      describe(
        'assetCompanies',
        'List companies in the assets scope',
        listResponse(object, pageMeta),
      ),
      apiValidator('query', assetCompanyQuery),
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
      '/',
      allowed('read'),
      describe(
        'assetList',
        'List fixed assets',
        listResponse(object, pageMeta),
      ),
      apiValidator('query', assetQuery),
      async (c) => {
        const principal = actor(c);
        const policies = await fieldPoliciesFor(db, principal);
        const result = await service.list(
          principal,
          c.req.valid('query'),
          await scoped(c),
        );
        return c.json({
          data: redactRows(result.rows, policies, ASSET_RESOURCE),
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
      async (c) => {
        const principal = actor(c);
        const policies = await fieldPoliciesFor(db, principal);
        return c.json({
          data: redactRecord(
            await service.detail(
              principal,
              c.req.valid('param').id,
              await scoped(c),
            ),
            policies,
            ASSET_RESOURCE,
          ),
        });
      },
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
      async (c) => {
        const principal = actor(c);
        const input = c.req.valid('json');
        const policies = await fieldPoliciesFor(db, principal);
        const catalogFields = await resourceFieldNames(db, ASSET_RESOURCE);
        assertFieldsWritable(
          policies,
          ASSET_RESOURCE,
          catalogFields.filter(
            (field) => field in input && isProvided((input as Record<string, unknown>)[field]),
          ),
        );
        return c.json(
          {
            data: await service.create(principal, input, await scoped(c)),
          },
          201,
        );
      },
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
      async (c) => {
        const principal = actor(c);
        const id = c.req.valid('param').id;
        const input = c.req.valid('json');
        const scope = await scoped(c);
        const policies = await fieldPoliciesFor(db, principal);
        // Reject a patch that would change a field this account may not
        // write, following the people contacts pattern: compare the patch
        // against the current record so unchanged read-only fields still save.
        const previous = await service.detail(principal, id, scope);
        const catalogFields = await resourceFieldNames(db, ASSET_RESOURCE);
        assertFieldsWritable(
          policies,
          ASSET_RESOURCE,
          catalogFields.filter((field) => {
            if (!(field in input)) return false;
            return (
              asComparable(field, (input as Record<string, unknown>)[field]) !==
              asComparable(field, (previous as Record<string, unknown>)[field])
            );
          }),
        );
        return c.json({
          data: await service.update(principal, id, input, scope),
        });
      },
    );

    router.post(
      '/batch-assign',
      allowed('manage'),
      describe(
        'assetBatchAssign',
        'Assign several fixed assets to one custodian',
        dataResponse(object),
      ),
      apiValidator('json', assetBatchAssign),
      async (c) =>
        c.json({
          data: await service.batchAssign(
            actor(c),
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/batch-return',
      allowed('manage'),
      describe(
        'assetBatchReturn',
        'Return several fixed assets to stock',
        dataResponse(object),
      ),
      apiValidator('json', assetBatchReturn),
      async (c) =>
        c.json({
          data: await service.batchReturn(
            actor(c),
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    for (const [action, schema] of [
      ['assign', assetAssign],
      ['return', assetReturn],
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
              ? await service.assign(actor(c), id, input as AssetAssign, scope)
              : await service.returnAsset(actor(c), id, input, scope);
          return c.json({ data });
        },
      );
    }

    router.post(
      '/:id/scrap/request',
      allowed('manage'),
      describe(
        'assetScrapRequest',
        'Request to scrap a fixed asset; requires approval before it applies',
        dataResponse(object),
      ),
      apiValidator('param', assetIdParams),
      apiValidator('json', assetScrapRequest),
      async (c) => {
        const data = await service.requestScrap(
          actor(c),
          c.req.valid('param').id,
          c.req.valid('json'),
          await scoped(c),
        );
        return c.json({ data });
      },
    );

    router.post(
      '/:id/scrap/decision',
      allowed('approve'),
      describe(
        'assetScrapDecision',
        'Approve or reject a scrap request',
        dataResponse(object),
      ),
      apiValidator('param', assetIdParams),
      apiValidator('json', assetScrapDecision),
      async (c) => {
        const data = await service.decideScrap(
          actor(c),
          c.req.valid('param').id,
          c.req.valid('json'),
          await scoped(c),
        );
        return c.json({ data });
      },
    );

    const root = new Hono();
    root.route('/assets', router);
    return root;
  });

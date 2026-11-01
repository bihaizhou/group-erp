import type { Application } from '@nocobase/app-server/application';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import {
  ApiError,
  defineApiRoutes,
  apiValidator,
  describeRoute,
  dataResponse,
  apiErrorResponses,
  apiErrorHandler,
} from '@nocobase/app-server/router';
import { LifecycleError, lifecycleErrorFields } from '@nocobase/lifecycle';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { materialSourceServiceToken } from '../providers/material-sources.js';
import {
  sourceRequest,
  sourceConfirm,
  sourceDecision,
  sourceParams,
  sourceError,
  type SourceAccess,
} from '../providers/material-source-model.js';
import { MaterialError } from '../providers/material-model.js';
import { SupplyChainError } from '../providers/supply-chain-model.js';
import { materialApiError } from './material-error.js';
type Env = AuthEnv &
  AuthorizationEnv & { Variables: { sourceAccess: SourceAccess } };
export const materialSourceRoutes = defineApiRoutes<Application>((app) => {
  const router = new Hono<Env>(),
    auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken),
    service = app.container.resolve(materialSourceServiceToken);
  const projection = z.record(z.string(), z.json());
  const describe = (operationId: string, response = projection) =>
    describeRoute({
      operationId,
      summary: operationId,
      tags: ['Material request sources'],
      responses: { 200: dataResponse(response), ...apiErrorResponses },
    });
  const allowed = (domain: string, action: string) =>
    createMiddleware<Env>(async (c, next) => {
      const ctx = c.get('authz'),
        resource = { type: 'composite' as const, id: `${domain}.requests` };
      const result = await ctx.authorize({ resource, action });
      if (result.effect === 'deny' || !result.conditions?.database)
        return sourceError('SUPPLY_FORBIDDEN', 'PERMISSION_DENIED');
      const delegate = await ctx.authorize({ resource, action: 'delegate' });
      c.set('sourceAccess', {
        policies: result.conditions.database,
        delegate:
          delegate.effect === 'deny'
            ? null
            : (delegate.conditions?.database ?? null),
      });
      await next();
    });
  const limit = bodyLimit({
    maxSize: 65536,
    onError: () => {
      throw new ApiError({
        status: 'INVALID_ARGUMENT',
        httpStatus: 413,
        domain: 'supplyChain',
        reason: 'BODY_TOO_LARGE',
        message: 'Payload too large.',
      });
    },
  });
  for (const [domain, kind] of [
    ['procurement', 'purchaseRequestLine'],
    ['requisitions', 'materialIssueRequestLine'],
  ] as const) {
    const base = `/${domain}/requests/:id`;
    for (const path of [
      `${base}/sources`,
      `${base}/lines/:lineId/sourceHistory`,
      `${base}/lines/:lineId/requestGovernance`,
      `${base}/lines/:lineId/confirmMaterial`,
      `${base}/lines/:lineId/rejectMaterial`,
      `${base}/lines/:lineId/takeOverSource`,
    ])
      router.use(path, auth.required(), authz.middleware());
    router.get(
      `${base}/sources`,
      allowed(domain, 'read'),
      describeRoute({
        operationId: `${domain}RequestSources`,
        summary:
          'Read material identification sources within the current parent request scope',
        tags: ['Material request sources'],
        responses: {
          200: dataResponse(z.array(projection)),
          ...apiErrorResponses,
        },
      }),
      apiValidator('param', z.object({ id: z.string().uuid() })),
      async (c) =>
        c.json({
          data: await service.list(
            kind,
            c.req.valid('param').id,
            { id: c.get('auth')!.user.id },
            c.get('sourceAccess'),
          ),
        }),
    );
    router.get(
      `${base}/lines/:lineId/sourceHistory`,
      allowed(domain, 'read'),
      describeRoute({
        operationId: `${domain}SourceHistory`,
        summary:
          'Read paginated material identification history for one authorized demand line',
        tags: ['Material request sources'],
        responses: {
          200: { description: 'Paginated source history' },
          ...apiErrorResponses,
        },
      }),
      apiValidator('param', sourceParams),
      apiValidator(
        'query',
        z.object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(50).default(10),
        }),
      ),
      async (c) =>
        c.json(
          await service.history(
            kind,
            c.req.valid('param').id,
            c.req.valid('param').lineId,
            c.req.valid('query'),
            c.get('sourceAccess'),
          ),
        ),
    );
    router.post(
      `${base}/lines/:lineId/requestGovernance`,
      allowed(domain, 'requestGovernance'),
      limit,
      describe(`${domain}RequestGovernance`),
      apiValidator('param', sourceParams),
      apiValidator('json', sourceRequest),
      async (c) =>
        c.json({
          data: await service.request(
            kind,
            c.req.valid('param').id,
            c.req.valid('param').lineId,
            c.req.valid('json'),
            { id: c.get('auth')!.user.id },
            c.get('sourceAccess'),
          ),
        }),
    );
    router.post(
      `${base}/lines/:lineId/confirmMaterial`,
      allowed(domain, 'confirmMaterial'),
      limit,
      describe(`${domain}ConfirmMaterial`),
      apiValidator('param', sourceParams),
      apiValidator('json', sourceConfirm),
      async (c) =>
        c.json({
          data: await service.confirm(
            kind,
            c.req.valid('param').id,
            c.req.valid('param').lineId,
            c.req.valid('json'),
            { id: c.get('auth')!.user.id },
            c.get('sourceAccess'),
          ),
        }),
    );
    for (const action of ['rejectMaterial', 'takeOverSource'] as const)
      router.post(
        `${base}/lines/:lineId/${action}`,
        allowed(domain, action),
        limit,
        describe(`${domain}${action}`),
        apiValidator('param', sourceParams),
        apiValidator('json', sourceDecision),
        async (c) =>
          c.json({
            data: await service.decide(
              kind,
              c.req.valid('param').id,
              c.req.valid('param').lineId,
              c.req.valid('json'),
              { id: c.get('auth')!.user.id },
              c.get('sourceAccess'),
              action === 'takeOverSource',
            ),
          }),
      );
  }
  const task = '/materials/requests/:id/sources';
  router.use(task, auth.required(), authz.middleware());
  router.get(
    task,
    describeRoute({
      operationId: 'materialGovernanceSource',
      summary: 'Read a minimal authorized governance source',
      tags: ['Material request sources'],
      responses: {
        200: dataResponse(z.array(projection)),
        ...apiErrorResponses,
      },
    }),
    apiValidator('param', z.object({ id: z.string().uuid() })),
    async (c) => {
      const result = await c.get('authz').authorize({
        resource: { type: 'composite', id: 'materials.sources' },
        action: 'read',
      });
      if (result.effect === 'deny' || !result.conditions?.database)
        return sourceError('SUPPLY_FORBIDDEN', 'PERMISSION_DENIED');
      return c.json({
        data: await service.summary(
          c.req.valid('param').id,
          result.conditions.database,
        ),
      });
    },
  );
  router.onError((error, c) => {
    if (error instanceof MaterialError)
      return apiErrorHandler(materialApiError(error), c);
    if (error instanceof SupplyChainError)
      return apiErrorHandler(
        new ApiError({
          status:
            error.reason === 'SUPPLY_FORBIDDEN'
              ? 'PERMISSION_DENIED'
              : 'FAILED_PRECONDITION',
          domain: 'supplyChain',
          reason: error.reason,
          message: 'The material source operation could not be completed.',
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
    if (error instanceof LifecycleError) {
      const fields = lifecycleErrorFields(error);
      if (fields)
        return apiErrorHandler(
          new ApiError({ ...fields, domain: 'supplyChain' }),
          c,
        );
    }
    return apiErrorHandler(error, c);
  });
  const root = new Hono();
  root.route('/', router);
  return root;
});

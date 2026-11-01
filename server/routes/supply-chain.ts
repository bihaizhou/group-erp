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
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { supplyChainMaterialServiceToken } from '../providers/supply-chain.js';
import {
  SupplyChainError,
  materialOptionsQuery,
  materialSelectionInput,
  materialSelectionOutput,
  materialOptionsMeta,
  supplyChainModules,
} from '../providers/supply-chain-model.js';
import type { MaterialPolicies } from '../providers/material-service.js';
import { MaterialError } from '../providers/material-model.js';
import { materialApiError } from './material-error.js';

type SupplyChainEnv = AuthEnv &
  AuthorizationEnv & { Variables: { materialPolicies: MaterialPolicies } };
const output = z.record(z.string(), z.json());
const errors = {
  ...apiErrorResponses,
  '400': apiErrorResponse(400),
  '404': apiErrorResponse(404),
};

export const supplyChainRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const service = app.container.resolve(supplyChainMaterialServiceToken);
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const router = new Hono<SupplyChainEnv>();
    router.onError((error, c) =>
      apiErrorHandler(
        error instanceof MaterialError
          ? materialApiError(error)
          : error instanceof SupplyChainError
            ? new ApiError({
                status:
                  error.reason === 'SUPPLY_FORBIDDEN'
                    ? 'PERMISSION_DENIED'
                    : error.reason === 'SUPPLY_SOURCE_STALE'
                      ? 'ABORTED'
                      : error.reason === 'SUPPLY_COMPANY_UNAVAILABLE' ||
                          error.reason === 'SUPPLY_MATERIAL_UNAVAILABLE'
                        ? 'NOT_FOUND'
                        : error.field
                          ? 'INVALID_ARGUMENT'
                          : 'FAILED_PRECONDITION',
                reason: error.reason,
                domain: 'supplyChain',
                message: error.reason,
                ...(error.field
                  ? {
                      fieldViolations: [
                        { field: error.field, description: error.reason },
                      ],
                    }
                  : {}),
              })
            : error,
        c,
      ),
    );
    for (const module of supplyChainModules) {
      const scope = new Hono<SupplyChainEnv>();
      const access = createMiddleware<SupplyChainEnv>(async (c, next) => {
        const decision = await c.get('authz').authorize({
          resource: { type: 'composite', id: `${module}.materials` },
          action: 'read',
        });
        if (decision.effect === 'deny' || !decision.conditions?.database)
          throw new SupplyChainError('SUPPLY_FORBIDDEN');
        c.set(
          'materialPolicies',
          decision.conditions.database as MaterialPolicies,
        );
        await next();
      });
      for (const path of [
        '/materialOptions',
        '/materialOptions/*',
        '/materialSelections',
      ])
        scope.use(path, auth.required(), authz.middleware(), access);
      scope.get(
        '/materialOptions',
        describeRoute({
          tags: ['Supply chain materials'],
          summary: `Search materials eligible for ${module} in an authorized company`,
          operationId: `${module}MaterialOptions`,
          responses: {
            '200': listResponse(output, materialOptionsMeta),
            ...errors,
          },
        }),
        apiValidator('query', materialOptionsQuery),
        async (c) =>
          c.json(
            await service.options(
              module,
              c.req.valid('query'),
              c.get('materialPolicies'),
            ),
          ),
      );
      scope.get(
        '/materialOptions/:id',
        describeRoute({
          tags: ['Supply chain materials'],
          summary: `Read eligible ${module} material and packaging details`,
          operationId: `${module}MaterialOption`,
          responses: { '200': dataResponse(output), ...errors },
        }),
        apiValidator('param', z.object({ id: z.string().uuid() })),
        apiValidator('query', z.strictObject({ subjectId: z.string().uuid() })),
        async (c) =>
          c.json(
            await service.detail(
              module,
              c.req.valid('query').subjectId,
              c.req.valid('param').id,
              c.get('materialPolicies'),
            ),
          ),
      );
      scope.post(
        '/materialSelections',
        describeRoute({
          tags: ['Supply chain materials'],
          summary: `Validate a ${module} demand selection and preview its exact quantity snapshot without saving a request`,
          operationId: `${module}MaterialSelection`,
          responses: {
            '200': dataResponse(materialSelectionOutput),
            ...errors,
            '413': apiErrorResponse(413),
          },
        }),
        bodyLimit({
          maxSize: 32768,
          onError: () => {
            throw new ApiError({
              status: 'INVALID_ARGUMENT',
              httpStatus: 413,
              reason: 'BODY_TOO_LARGE',
              domain: 'supplyChain',
              message: 'Payload too large.',
            });
          },
        }),
        apiValidator('json', materialSelectionInput),
        async (c) =>
          c.json({
            data: await service.resolveSelection(
              module,
              c.req.valid('json'),
              c.get('materialPolicies'),
            ),
          }),
      );
      router.route(`/${module}`, scope);
    }
    const root = new Hono();
    root.route('/', router);
    return root;
  });

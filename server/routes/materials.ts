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
import { LifecycleError, lifecycleErrorFields } from '@nocobase/lifecycle';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { materialServiceToken } from '../providers/materials.js';
import {
  materialKinds,
  materialQuery,
  materialSchemas,
  materialWorkflowKinds,
  MaterialError,
  type MaterialActor,
} from '../providers/material-model.js';
import type { MaterialPolicies } from '../providers/material-service.js';
import { materialApiError } from './material-error.js';

type MaterialEnv = AuthEnv &
  AuthorizationEnv & { Variables: { materialPolicies: MaterialPolicies } };
const output = z.record(z.string(), z.json());
const responses = {
  ...apiErrorResponses,
  '400': apiErrorResponse(400),
  '404': apiErrorResponse(404),
  '409': apiErrorResponse(409),
};
const param = z.object({ id: z.string().uuid() });
const transitionInput = z.strictObject({
  version: z.number().int().min(0),
  requestKey: z.string().min(1).max(100),
  reason: z.string().trim().min(1).max(1000),
  resolvedSkuId: z.string().uuid().optional(),
});
export const materialRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const service = app.container.resolve(materialServiceToken);
    const authentication = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const router = new Hono<MaterialEnv>();
    router.use(
      '/materials/*',
      authentication.required(),
      authz.middleware(),
      bodyLimit({
        maxSize: 262144,
        onError: () => {
          throw new ApiError({
            status: 'INVALID_ARGUMENT',
            httpStatus: 413,
            reason: 'BODY_TOO_LARGE',
            domain: 'materials',
            message: 'Payload too large.',
          });
        },
      }),
    );
    const actor = (c: {
      get: (key: 'auth') => AuthEnv['Variables']['auth'];
    }): MaterialActor => {
      const { user } = c.get('auth')!;
      return { id: user.id, name: user.name || user.email };
    };
    const access = (
      resource: string | ((c: Context<MaterialEnv>) => string),
      action = 'read',
    ) =>
      createMiddleware<MaterialEnv>(async (c, next) => {
        const name = typeof resource === 'string' ? resource : resource(c);
        const decision = await c.get('authz').authorize({
          resource: { type: 'composite', id: `materials.${name}` },
          action,
        });
        if (decision.effect === 'deny' || !decision.conditions?.database)
          throw new ApiError({
            status: 'PERMISSION_DENIED',
            reason: 'MATERIAL_FORBIDDEN',
            domain: 'materials',
            message: 'Not permitted.',
          });
        c.set(
          'materialPolicies',
          decision.conditions.database as MaterialPolicies,
        );
        await next();
      });
    router.onError((error, c) => {
      if (error instanceof MaterialError)
        return apiErrorHandler(materialApiError(error), c);
      if (error instanceof z.ZodError)
        return apiErrorHandler(
          new ApiError({
            status: 'INVALID_ARGUMENT',
            reason: 'MATERIAL_INVALID_INPUT',
            domain: 'materials',
            message: 'Invalid material input.',
            fieldViolations: error.issues.map((issue) => ({
              field: issue.path.join('.'),
              description: 'Invalid value.',
            })),
          }),
          c,
        );
      if (error instanceof LifecycleError) {
        const fields = lifecycleErrorFields(error);
        if (fields)
          return apiErrorHandler(
            new ApiError({ ...fields, domain: 'materials' }),
            c,
          );
      }
      return apiErrorHandler(error, c);
    });
    router.get(
      '/materials/options',
      access((c) => c.req.query('kind') ?? 'skus'),
      describeRoute({
        tags: ['Materials'],
        summary: 'Read scoped material options',
        operationId: 'materialOptions',
        responses: { '200': dataResponse(output), ...responses },
      }),
      apiValidator(
        'query',
        z.object({
          kind: z.enum([...materialKinds, 'catalog']),
          q: z.string().max(200).optional(),
          selectedId: z
            .union([z.string().uuid(), z.array(z.string().uuid()).max(100)])
            .optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid('query');
        return c.json({
          data: await service.options(
            query.kind,
            c.get('materialPolicies'),
            query.q,
            query.selectedId ? [query.selectedId].flat() : [],
          ),
        });
      },
    );
    // Registered before the per-kind `/:id` routes so `code-suggestion` is not
    // read as a standard-name identifier.
    router.get(
      '/materials/names/code-suggestion',
      access('names'),
      describeRoute({
        tags: ['Materials'],
        summary: 'Suggest a unique code from a standard name',
        operationId: 'materialNameCode',
        responses: { '200': dataResponse(output), ...responses },
      }),
      apiValidator(
        'query',
        z.object({ name: z.string().trim().min(1).max(200) }),
      ),
      async (c) => {
        const query = c.req.valid('query');
        return c.json({
          data: await service.suggestNameCode(
            query.name,
            c.get('materialPolicies'),
          ),
        });
      },
    );
    // Registered before the per-kind `/:id` routes so `similar` is not read as
    // a standard-name identifier.
    router.get(
      '/materials/names/similar',
      access('names'),
      describeRoute({
        tags: ['Materials'],
        summary: 'Find standard names similar to a proposed name',
        operationId: 'materialNameSimilar',
        responses: { '200': dataResponse(output), ...responses },
      }),
      apiValidator(
        'query',
        z.object({
          name: z.string().trim().min(1).max(200),
          excludeId: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(10).default(5),
        }),
      ),
      async (c) => {
        const query = c.req.valid('query');
        return c.json({
          data: await service.similarNames(
            query.name,
            c.get('materialPolicies'),
            query.excludeId,
            query.limit,
          ),
        });
      },
    );
    router.get(
      '/materials/catalog',
      access('catalog'),
      describeRoute({
        tags: ['Materials'],
        summary: 'Search the active public material catalog',
        operationId: 'materialCatalog',
        responses: { '200': listResponse(output), ...responses },
      }),
      apiValidator('query', materialQuery),
      async (c) =>
        c.json(
          await service.catalog(
            c.req.valid('query'),
            c.get('materialPolicies'),
          ),
        ),
    );
    router.get(
      '/materials/catalog/:id',
      access('catalog'),
      describeRoute({
        tags: ['Materials'],
        summary: 'Read public catalog details',
        operationId: 'materialCatalogRecord',
        responses: { '200': dataResponse(output), ...responses },
      }),
      apiValidator('param', param),
      async (c) =>
        c.json(
          await service.catalog(
            materialQuery.parse({}),
            c.get('materialPolicies'),
            c.req.valid('param').id,
          ),
        ),
    );
    router.get(
      '/materials/history',
      access('history'),
      describeRoute({
        tags: ['Materials'],
        summary: 'Read material audit history',
        operationId: 'materialHistory',
        responses: { '200': listResponse(output), ...responses },
      }),
      apiValidator(
        'query',
        z.object({
          kind: z.enum(materialKinds).optional(),
          recordId: z.string().uuid().optional(),
          q: z.string().trim().max(200).optional(),
          orderBy: z.enum(['createdAt', '-createdAt']).default('-createdAt'),
          page: z.coerce.number().int().min(1).default(1),
        }),
      ),
      async (c) =>
        c.json(
          await service.history(
            c.req.valid('query'),
            c.get('materialPolicies'),
          ),
        ),
    );
    for (const kind of materialKinds) {
      const path = `/materials/${kind}`;
      router.get(
        path,
        access(kind),
        describeRoute({
          tags: ['Materials'],
          summary: `List material ${kind}`,
          operationId: `materialList_${kind}`,
          responses: { '200': listResponse(output), ...responses },
        }),
        apiValidator('query', materialQuery),
        async (c) =>
          c.json(
            await service.list(
              kind,
              c.req.valid('query'),
              c.get('materialPolicies'),
            ),
          ),
      );
      router.get(
        `${path}/:id`,
        access(kind),
        describeRoute({
          tags: ['Materials'],
          summary: `Read material ${kind}`,
          operationId: `materialGet_${kind}`,
          responses: { '200': dataResponse(output), ...responses },
        }),
        apiValidator('param', param),
        async (c) =>
          c.json({
            data: await service.get(
              kind,
              c.req.valid('param').id,
              c.get('materialPolicies'),
              actor(c),
            ),
          }),
      );
      router.post(
        path,
        access(kind, 'update'),
        describeRoute({
          tags: ['Materials'],
          summary: `Create material ${kind}`,
          operationId: `materialCreate_${kind}`,
          responses: { '201': dataResponse(output), ...responses },
        }),
        apiValidator('json', materialSchemas[kind]),
        async (c) =>
          c.json(
            {
              data: await service.save(
                kind,
                c.req.valid('json'),
                actor(c),
                c.get('materialPolicies'),
              ),
            },
            201,
          ),
      );
      router.patch(
        `${path}/:id`,
        access(kind, 'update'),
        describeRoute({
          tags: ['Materials'],
          summary: `Edit material ${kind}`,
          operationId: `materialUpdate_${kind}`,
          responses: { '200': dataResponse(output), ...responses },
        }),
        apiValidator('param', param),
        apiValidator(
          'json',
          materialSchemas[kind].partial().extend({
            version: z.number().int().positive(),
            reason: z.string().trim().min(1).max(1000),
          }),
        ),
        async (c) =>
          c.json({
            data: await service.save(
              kind,
              c.req.valid('json'),
              actor(c),
              c.get('materialPolicies'),
              c.req.valid('param').id,
            ),
          }),
      );
      const transitions =
        kind === 'requests'
          ? ['submit', 'return', 'resolve', 'withdraw']
          : materialWorkflowKinds.includes(kind)
            ? ['submit', 'return', 'approve', 'deactivate', 'reactivate']
            : ['deactivate', 'reactivate'];
      for (const transition of transitions) {
        const action =
          (kind === 'requests' && ['return', 'resolve'].includes(transition)) ||
          (kind !== 'requests' &&
            materialWorkflowKinds.includes(kind) &&
            transition !== 'submit')
            ? 'review'
            : 'update';
        router.post(
          `${path}/:id/${transition}`,
          access(kind, action),
          describeRoute({
            tags: ['Materials'],
            summary: `${transition} material ${kind}`,
            operationId: `material_${kind}_${transition}`,
            responses: { '200': dataResponse(output), ...responses },
          }),
          apiValidator('param', param),
          apiValidator('json', transitionInput),
          async (c) =>
            c.json({
              data: await service.fire(
                kind,
                c.req.valid('param').id,
                transition,
                c.req.valid('json'),
                actor(c),
                c.get('materialPolicies'),
              ),
            }),
        );
      }
    }
    const root = new Hono();
    root.route('/', router);
    return root;
  });

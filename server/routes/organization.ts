import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import type { Application } from '@nocobase/app-server/application';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
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
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { organizationServiceToken } from '../providers/organization.js';
import {
  kinds,
  inputSchemas,
  orgResource,
  OrganizationError,
} from '../providers/organization-model.js';

const params = z.object({ id: z.string().uuid() });
const query = z.strictObject({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  subjectId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  sectorId: z.string().uuid().optional(),
  regionId: z.string().uuid().optional(),
  kind: z.enum(kinds).optional(),
  recordId: z.string().uuid().optional(),
  orderBy: z
    .enum(['updatedAt', '-updatedAt', 'createdAt', '-createdAt'])
    .optional(),
});
const record = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    status: z.enum(['active', 'inactive']),
    version: z.number(),
    sortOrder: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .catchall(z.json());
const reason = z.string().trim().min(1).max(1000);
const version = z.number().int().positive();
const errors = {
  ...apiErrorResponses,
  '400': apiErrorResponse(400),
  '404': apiErrorResponse(404),
  '409': apiErrorResponse(409),
};

export const organizationRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const service = app.container.resolve(organizationServiceToken);
    const router = new Hono<AuthEnv & AuthorizationEnv>();
    const access =
      (
        action: 'read' | 'update',
      ): MiddlewareHandler<AuthEnv & AuthorizationEnv> =>
      async (c, next) => {
        await c.get('authz').require({ resource: orgResource, action });
        await next();
      };
    router.use('*', auth.required(), authz.middleware());
    router.use(
      '*',
      bodyLimit({
        maxSize: 65536,
        onError: () => {
          throw new ApiError({
            status: 'INVALID_ARGUMENT',
            httpStatus: 413,
            reason: 'BODY_TOO_LARGE',
            domain: 'organization',
            message: 'Organization payload is too large.',
          });
        },
      }),
    );
    router.onError((error, c) => {
      if (error instanceof OrganizationError) {
        const status =
          error.reason === 'ORG_NOT_FOUND'
            ? 'NOT_FOUND'
            : error.reason === 'ORG_CODE_EXISTS'
              ? 'ALREADY_EXISTS'
              : error.reason === 'ORG_VERSION_CONFLICT'
                ? 'ABORTED'
                : error.field
                  ? 'INVALID_ARGUMENT'
                  : 'FAILED_PRECONDITION';
        return apiErrorHandler(
          new ApiError({
            status,
            reason: error.reason,
            domain: 'organization',
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
      }
      return apiErrorHandler(error, c);
    });
    for (const path of ['tree', 'options'] as const) {
      router.get(
        `/${path}`,
        access('read'),
        describeRoute({
          tags: ['Organization'],
          summary: `Read organization ${path}`,
          operationId: `getOrganization${path === 'tree' ? 'Tree' : 'Options'}`,
          responses: {
            '200': dataResponse(z.record(z.string(), z.json())),
            ...apiErrorResponses,
          },
        }),
        async (c) => c.json({ data: await service.options() }),
      );
    }
    router.get(
      '/history',
      access('read'),
      describeRoute({
        tags: ['Organization'],
        summary: 'Read organization changes',
        operationId: 'listOrganizationHistory',
        responses: {
          '200': listResponse(z.record(z.string(), z.json())),
          ...apiErrorResponses,
        },
      }),
      apiValidator('query', query),
      async (c) => c.json(await service.history(c.req.valid('query'))),
    );
    for (const kind of kinds) {
      router.get(
        `/${kind}`,
        access('read'),
        describeRoute({
          tags: ['Organization'],
          summary: `List organization ${kind}`,
          operationId: `listOrganization${kind}`,
          responses: { '200': listResponse(record), ...apiErrorResponses },
        }),
        apiValidator('query', query),
        async (c) => c.json(await service.list(kind, c.req.valid('query'))),
      );
      router.get(
        `/${kind}/:id`,
        access('read'),
        describeRoute({
          tags: ['Organization'],
          summary: `Read organization ${kind}`,
          operationId: `getOrganization${kind}`,
          responses: {
            '200': dataResponse(record),
            ...apiErrorResponses,
            '404': apiErrorResponse(404),
          },
        }),
        apiValidator('param', params),
        async (c) =>
          c.json({ data: await service.get(kind, c.req.valid('param').id) }),
      );
      router.post(
        `/${kind}`,
        access('update'),
        describeRoute({
          tags: ['Organization'],
          summary: `Create organization ${kind}`,
          operationId: `createOrganization${kind}`,
          responses: { '201': dataResponse(record), ...errors },
        }),
        apiValidator('json', inputSchemas[kind]),
        async (c) => {
          const { user } = c.get('auth')!;
          return c.json(
            {
              data: await service.save(kind, c.req.valid('json'), {
                id: user.id,
                name: user.name || user.email,
              }),
            },
            201,
          );
        },
      );
      router.patch(
        `/${kind}/:id`,
        access('update'),
        describeRoute({
          tags: ['Organization'],
          summary: `Edit organization ${kind}`,
          operationId: `updateOrganization${kind}`,
          responses: { '200': dataResponse(record), ...errors },
        }),
        apiValidator('param', params),
        apiValidator(
          'json',
          inputSchemas[kind].partial().extend({ version, reason }),
        ),
        async (c) => {
          const { user } = c.get('auth')!;
          return c.json({
            data: await service.save(
              kind,
              c.req.valid('json'),
              { id: user.id, name: user.name || user.email },
              c.req.valid('param').id,
            ),
          });
        },
      );
      router.post(
        `/${kind}/:id/setStatus`,
        access('update'),
        describeRoute({
          tags: ['Organization'],
          summary: `Enable or disable organization ${kind}`,
          operationId: `setOrganization${kind}Status`,
          responses: { '200': dataResponse(record), ...errors },
        }),
        apiValidator('param', params),
        apiValidator(
          'json',
          z.strictObject({
            version,
            reason,
            status: z.enum(['active', 'inactive']),
          }),
        ),
        async (c) => {
          const { user } = c.get('auth')!;
          return c.json({
            data: await service.save(
              kind,
              c.req.valid('json'),
              { id: user.id, name: user.name || user.email },
              c.req.valid('param').id,
            ),
          });
        },
      );
    }
    const root = new Hono();
    root.route('/organization', router);
    return root;
  });

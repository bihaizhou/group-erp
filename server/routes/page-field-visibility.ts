import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Application } from '@nocobase/app-server/application';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import {
  ApiError,
  apiValidator,
  dataResponse,
  defineApiRoutes,
  describeRoute,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono, type Context } from 'hono';
import {
  effectivePageFieldVisibility,
  pageFieldVisibilityConfig,
} from '../providers/page-field-visibility.js';

type Env = AuthEnv & AuthorizationEnv;

const field = z.object({
  resource: z.string().min(1).max(160),
  field: z.string().min(1).max(160),
  visible: z.boolean(),
});

const query = z.object({
  permissionSetKey: z.string().min(1).max(120),
  pageKey: z.string().min(1).max(200),
  fallbackPageKey: z.string().min(1).max(200).optional(),
});

const effectiveQuery = z.object({
  pageKey: z.string().min(1).max(200),
  fallbackPageKey: z.string().min(1).max(200).optional(),
});

const saveBody = z.object({
  permissionSetKey: z.string().min(1).max(120),
  pageKey: z.string().min(1).max(200),
  fallbackPageKey: z.string().min(1).max(200).optional(),
  mode: z.enum(['inherit', 'override']).optional(),
  fields: z.array(field).max(500),
});

const response = z.object({
  mode: z.enum(['independent', 'inherit', 'override']),
  configured: z.boolean(),
  inheritedFrom: z.string().optional(),
  fields: z.array(field),
});

const effectiveResponse = z.object({
  configured: z.boolean(),
  visible: z.array(z.string()),
  fields: z.array(field),
});

const denied = () =>
  new ApiError({
    status: 'PERMISSION_DENIED',
    domain: 'authorization',
    reason: 'PERMISSION_DENIED',
    message: 'Permission set access denied',
  });

export const pageFieldVisibilityRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const db = app.container.resolve(databaseManagerToken);
    const router = new Hono<Env>();
    router.use('*', auth.required(), authz.middleware());

    const check = async (c: Context<Env>, action: 'read' | 'update') => {
      const decision = await c.get('authz').authorize({
        resource: { type: 'settings', id: 'authorization.permission-sets' },
        action,
      });
      if (decision.effect === 'deny') throw denied();
    };

    router.get(
      '/effective',
      describeRoute({
        tags: ['Authorization'],
        summary: 'Read page field visibility for the signed-in account',
        operationId: 'getEffectivePageFieldVisibility',
        responses: { '200': dataResponse(effectiveResponse) },
      }),
      apiValidator('query', effectiveQuery),
      async (c) => {
        const user = c.get('auth')!.user;
        const { pageKey, fallbackPageKey } = c.req.valid('query');
        return c.json({
          data: await effectivePageFieldVisibility(
            db,
            { type: 'user', id: user.id },
            pageKey,
            fallbackPageKey,
          ),
        });
      },
    );

    router.get(
      '/',
      describeRoute({
        tags: ['Authorization'],
        summary: 'Read page field visibility of one permission set',
        operationId: 'getPageFieldVisibility',
        responses: { '200': dataResponse(response) },
      }),
      apiValidator('query', query),
      async (c) => {
        await check(c, 'read');
        const { permissionSetKey, pageKey, fallbackPageKey } =
          c.req.valid('query');
        return c.json({
          data: await pageFieldVisibilityConfig(
            db,
            permissionSetKey,
            pageKey,
            fallbackPageKey,
          ),
        });
      },
    );

    router.put(
      '/',
      describeRoute({
        tags: ['Authorization'],
        summary: 'Replace page field visibility of one permission set',
        operationId: 'savePageFieldVisibility',
        responses: { '200': dataResponse(response) },
      }),
      apiValidator('json', saveBody),
      async (c) => {
        await check(c, 'update');
        const { permissionSetKey, pageKey, fallbackPageKey, mode, fields } =
          c.req.valid('json');
        const set = await db
          .repository('authorizationPermissionSets')
          .findOne({ filter: { key: permissionSetKey } });
        if (!set) throw denied();
        const userId = c.get('auth')!.user.id;
        await db.repository('appPageFieldVisibilities').deleteMany({
          filter: { permissionSetKey, pageKey },
        });
        if (mode !== 'inherit') {
          for (const item of fields) {
            await db.repository('appPageFieldVisibilities').createOne({
              values: {
                id: randomUUID(),
                permissionSetKey,
                pageKey,
                resource: item.resource,
                field: item.field,
                visible: item.visible,
                version: 1,
                createdBy: userId,
                updatedBy: userId,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            });
          }
        }
        return c.json({
          data: await pageFieldVisibilityConfig(
            db,
            permissionSetKey,
            pageKey,
            fallbackPageKey,
          ),
        });
      },
    );

    const root = new Hono();
    root.route('/page-field-visibility', router);
    return root;
  });

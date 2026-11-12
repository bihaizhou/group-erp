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
import { fieldPoliciesFor } from '../providers/field-access.js';
import { fieldCatalog } from '../providers/field-catalog.js';

type Env = AuthEnv & AuthorizationEnv;

const access = z.enum(['hidden', 'visible', 'readonly', 'write']);

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const response = z.object({
  policies: z.array(
    z.object({
      resource: z.string(),
      field: z.string(),
      access,
    }),
  ),
});

const listResponse = response.extend({ legacyDefault: z.boolean() });

const catalogResponse = z.object({
  resources: z.array(
    z.object({
      resource: z.string(),
      titleKey: z.string(),
      descriptionKey: z.string(),
      fields: z.array(
        z.object({
          field: z.string(),
          titleKey: z.string().optional(),
          label: z.string(),
          writable: z.boolean(),
        }),
      ),
    }),
  ),
});

const listQuery = z.object({ permissionSetKey: z.string().min(1).max(120) });

const saveBody = z.object({
  permissionSetKey: z.string().min(1).max(120),
  policies: z
    .array(
      z.object({
        resource: z.string().min(1).max(120),
        field: z.string().min(1).max(120),
        access,
      }),
    )
    .max(500),
});

const denied = () =>
  new ApiError({
    status: 'PERMISSION_DENIED',
    domain: 'authorization',
    reason: 'PERMISSION_DENIED',
    message: 'Permission set access denied',
  });

/**
 * Field policies for the permission-set editor plus the signed-in account's
 * effective policies. Pages read the effective list to hide or lock a field;
 * the server applies the same rules when it reads or writes the record.
 */
export const fieldPolicyRoutes: AppApiRouteContribution<Application> =
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
      '/catalog',
      describeRoute({
        tags: ['Authorization'],
        summary: 'List resources and fields available for field policies',
        operationId: 'getFieldPolicyCatalog',
        responses: { '200': dataResponse(catalogResponse) },
      }),
      async (c) => c.json({ data: { resources: await fieldCatalog(db) } }),
    );

    router.get(
      '/effective',
      describeRoute({
        tags: ['Authorization'],
        summary: 'Read the signed-in account field policies',
        operationId: 'getEffectiveFieldPolicies',
        responses: { '200': dataResponse(response) },
      }),
      async (c) => {
        const user = c.get('auth')!.user;
        const policies = await fieldPoliciesFor(db, {
          type: 'user',
          id: user.id,
        });
        return c.json({ data: { policies } });
      },
    );

    router.get(
      '/',
      describeRoute({
        tags: ['Authorization'],
        summary: 'Read the field policies of one permission set',
        operationId: 'getFieldPolicies',
        responses: { '200': dataResponse(listResponse) },
      }),
      apiValidator('query', listQuery),
      async (c) => {
        await check(c, 'read');
        const { permissionSetKey } = c.req.valid('query');
        const rows = await db.repository('appFieldPolicies').findMany({
          filter: { permissionSetKey },
          limit: 500,
          sort: (sort) => [
            sort.field('resource').asc(),
            sort.field('field').asc(),
          ],
        });
        const policies = rows
          .map((row) => ({
            resource: asText(row.resource),
            field: asText(row.field),
            access: row.access as 'hidden' | 'visible' | 'readonly' | 'write',
          }))
          .filter((row) => row.resource && row.field);
        const legacyDefault = policies.some(
          (row) => row.resource === '$default' && row.field === 'legacy',
        );
        return c.json({
          data: {
            policies: policies.filter(
              (row) => !(row.resource === '$default' && row.field === 'legacy'),
            ),
            legacyDefault,
          },
        });
      },
    );

    router.put(
      '/',
      describeRoute({
        tags: ['Authorization'],
        summary: 'Replace the field policies of one permission set',
        operationId: 'saveFieldPolicies',
        responses: { '200': dataResponse(response) },
      }),
      apiValidator('json', saveBody),
      async (c) => {
        await check(c, 'update');
        const { permissionSetKey, policies } = c.req.valid('json');
        const set = await db
          .repository('authorizationPermissionSets')
          .findOne({ filter: { key: permissionSetKey } });
        if (!set) throw denied();
        const userId = c.get('auth')!.user.id;
        const existing = await db.repository('appFieldPolicies').findMany({
          filter: { permissionSetKey },
          limit: 500,
        });
        const nextKeys = new Set(
          policies.map((item) => `${item.resource}.${item.field}`),
        );
        for (const row of existing) {
          const key = `${asText(row.resource)}.${asText(row.field)}`;
          if (!nextKeys.has(key)) {
            await db
              .repository('appFieldPolicies')
              .deleteOne({ filter: { id: asText(row.id) } });
          }
        }
        for (const item of policies) {
          const current = existing.find(
            (row) =>
              asText(row.resource) === item.resource &&
              asText(row.field) === item.field,
          );
          if (current && current.access === item.access) continue;
          if (current) {
            await db.repository('appFieldPolicies').updateOne({
              filter: { id: asText(current.id) },
              values: {
                access: item.access,
                version: Number(current.version ?? 1) + 1,
                updatedBy: userId,
                updatedAt: new Date(),
              },
            });
          } else {
            await db.repository('appFieldPolicies').createOne({
              values: {
                id: randomUUID(),
                permissionSetKey,
                settingsId: null,
                resource: item.resource,
                field: item.field,
                access: item.access,
                version: 1,
                createdBy: userId,
                updatedBy: userId,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            });
          }
        }
        return c.json({ data: { policies } });
      },
    );

    const root = new Hono();
    root.route('/field-policies', router);
    return root;
  });

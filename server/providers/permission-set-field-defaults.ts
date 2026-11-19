import { randomUUID } from 'node:crypto';
import type { Application } from '@nocobase/app-server/application';
import type { AppHttpMiddleware } from '@nocobase/app-server/router';
import { databaseManagerToken } from '@nocobase/db';

const isPermissionSetCreate = (method: string, path: string): boolean =>
  method === 'POST' && /\/authorization\/permissionSets$/.test(path);

type CreatedBody = { data?: { key?: unknown } };

/**
 * New permission sets start on the deny-by-default field model.
 *
 * A set without the `$default.model` marker is legacy: a field with no policy
 * stays visible and writable. That is the right default for the sets seeded
 * before field policies existed, but a brand-new role should start with the
 * minimum it is explicitly granted. Writing the marker at creation time makes
 * every newly created set start on the ladder model (an absent policy means
 * hidden) without touching the legacy sets, whose explicit conversion is a
 * separate, auditable decision.
 */
export const permissionSetFieldDefaults: AppHttpMiddleware<Application> = {
  name: 'permission-set-field-defaults',
  register(router, app) {
    router.use('*', async (context, next) => {
      await next();
      if (
        context.res.status !== 201 ||
        !isPermissionSetCreate(context.req.method, context.req.path)
      ) {
        return;
      }
      let body: CreatedBody;
      try {
        body = (await context.res.clone().json()) as CreatedBody;
      } catch {
        return;
      }
      const key = body?.data?.key;
      if (typeof key !== 'string' || !key) return;
      const database = app.container.resolve(databaseManagerToken);
      // Idempotent replays return 201 again, so a second insert would violate
      // the (permissionSetKey, resource, field) unique index and fail the
      // request that merely repeated a committed create.
      const existing = await database.repository('appFieldPolicies').exists({
        filter: { permissionSetKey: key, resource: '$default', field: 'model' },
      });
      if (existing) return;
      const now = new Date();
      await database.repository('appFieldPolicies').createOne({
        values: {
          id: randomUUID(),
          permissionSetKey: key,
          settingsId: null,
          resource: '$default',
          field: 'model',
          access: 'visible',
          version: 1,
          createdBy: 'system:permission-set-defaults',
          updatedBy: 'system:permission-set-defaults',
          createdAt: now,
          updatedAt: now,
        },
      });
    });
  },
};

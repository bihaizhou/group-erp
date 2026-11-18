import { randomUUID } from 'node:crypto';
import type { Application } from '@nocobase/app-server/application';
import type { AppHttpMiddleware } from '@nocobase/app-server/router';
import { PAGE_ID_SET } from '../../database/main/permissions/page-catalog.js';

type GrantBody = {
  grants?: unknown;
};

type Grant = {
  resource?: { type?: unknown; id?: unknown };
};

const isPermissionSetWrite = (method: string, path: string): boolean =>
  (method === 'POST' || method === 'PUT' || method === 'PATCH') &&
  /\/authorization\/permissionSets(\/|$)/.test(path);

/**
 * Rejects permission sets that grant a page the client no longer serves.
 *
 * The authorization plugin validates `composite` and `settings` grants against
 * its server-side resource registry, but `{ type: 'page' }` resources live only
 * in the client route tree, so the plugin accepts any page id. Without this
 * guard a merged or renamed page leaves a grant that silently matches nothing,
 * and roles keep looking correct while their pages never open.
 *
 * The allowed ids are generated from the route tree into
 * database/main/permissions/page-catalog.ts, and
 * tests/client/page-catalog.test.ts fails when the file drifts.
 */
export const permissionSetPageValidation: AppHttpMiddleware<Application> = {
  name: 'permission-set-page-validation',
  register(router) {
    router.use('*', async (context, next) => {
      if (!isPermissionSetWrite(context.req.method, context.req.path)) {
        return next();
      }
      // Clone the request so the plugin's own validator can still read the
      // body: reading the live stream here would consume it.
      let body: unknown;
      try {
        body = await context.req.raw.clone().json();
      } catch {
        return next();
      }
      const grants = (body as GrantBody | null)?.grants;
      if (!Array.isArray(grants)) {
        return next();
      }
      for (const grant of grants as Grant[]) {
        const resource = grant?.resource;
        if (
          !resource ||
          resource.type !== 'page' ||
          typeof resource.id !== 'string'
        ) {
          continue;
        }
        if (PAGE_ID_SET.has(resource.id)) {
          continue;
        }
        const requestId = randomUUID();
        context.header('x-request-id', requestId);
        return context.json(
          {
            error: {
              code: 400,
              status: 'INVALID_ARGUMENT',
              reason: 'UNKNOWN_PAGE_PERMISSION',
              domain: 'authorization',
              message: `Unknown page permission "${resource.id}": the page no longer exists in the client route tree.`,
              requestId,
            },
          },
          400,
        );
      }
      return next();
    });
  },
};

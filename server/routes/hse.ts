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
  hseCertificateCreate,
  hseCertificateQuery,
  hseCertificateTransition,
  hseCertificateUpdate,
  hseHazardCreate,
  hseHazardQuery,
  hseHazardTransition,
  hseHazardUpdate,
  hseIdParams,
  hseIncidentCreate,
  hseIncidentQuery,
  hseIncidentTransition,
  hseIncidentUpdate,
  hseOverviewQuery,
} from '../providers/hse-model.js';
import {
  HseError,
  type HseScope,
  hseServiceToken,
} from '../providers/hse-service.js';

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

function toApiError(error: HseError) {
  const status =
    error.code === 'HSE_FORBIDDEN'
      ? 'PERMISSION_DENIED'
      : error.code === 'HSE_NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'HSE_CONFLICT'
          ? 'ABORTED'
          : 'INVALID_ARGUMENT';
  return new ApiError({
    status,
    domain: 'hse',
    reason: error.code,
    message: error.message,
  });
}

export const hseRoutes: AppApiRouteContribution<Application> = defineApiRoutes(
  (app) => {
    const service = app.container.resolve(hseServiceToken);
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const router = new Hono<Env>();
    for (const path of [
      '/overview',
      '/options',
      '/companies',
      '/incidents',
      '/incidents/*',
      '/hazards',
      '/hazards/*',
      '/certificates',
      '/certificates/*',
      '/operations-summary',
    ])
      router.use(path, auth.required(), authz.middleware());
    const actor = (c: Context<Env>) => ({
      type: 'user',
      id: c.get('auth')!.user.id,
    });
    const scoped = async (c: Context<Env>): Promise<HseScope> => {
      const context = c.get('authz');
      const result = async (action: string) =>
        (
          await context.authorize({
            resource: { type: 'settings', id: 'hse' },
            action,
          })
        ).effect !== 'deny';
      return {
        readAll: await result('readAll'),
        manage: await result('manage'),
        approve: await result('approve'),
      };
    };
    const allowed = (action: 'read' | 'manage' | 'approve') =>
      createMiddleware<Env>(async (c, next) => {
        const result = await c.get('authz').authorize({
          resource: { type: 'settings', id: 'hse' },
          action,
        });
        if (result.effect === 'deny')
          throw new HseError('HSE_FORBIDDEN', 'PERMISSION_DENIED');
        await next();
      });
    const allowedAny = (actions: ('read' | 'manage' | 'approve')[]) =>
      createMiddleware<Env>(async (c, next) => {
        for (const action of actions) {
          const result = await c.get('authz').authorize({
            resource: { type: 'settings', id: 'hse' },
            action,
          });
          if (result.effect !== 'deny') {
            await next();
            return;
          }
        }
        throw new HseError('HSE_FORBIDDEN', 'PERMISSION_DENIED');
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
        tags: ['HSE'],
        responses: { [String(ok)]: response, ...errors },
      });
    router.onError((error, c) => {
      if (error instanceof HseError)
        return apiErrorHandler(toApiError(error), c);
      return apiErrorHandler(error, c);
    });

    router.get(
      '/companies',
      allowed('read'),
      describe(
        'hseCompanies',
        'List companies available to HSE',
        dataResponse(object),
      ),
      async (c) => {
        const options = await service.options(actor(c), await scoped(c));
        const items = options.subjects
          .filter((subject) => subject.type === 'company')
          .map((subject) => ({
            id: subject.id,
            code: subject.code,
            name: subject.name,
          }));
        return c.json({
          data: items,
          meta: { total: items.length, page: 1, pageSize: items.length },
        });
      },
    );

    router.get(
      '/overview',
      allowed('read'),
      describe(
        'hseOverview',
        'Read HSE overview counts and recent records',
        dataResponse(object),
      ),
      apiValidator('query', hseOverviewQuery),
      async (c) =>
        c.json({ data: await service.overview(actor(c), await scoped(c)) }),
    );

    router.get(
      '/options',
      allowed('read'),
      describe(
        'hseOptions',
        'Read companies and units in the HSE data scope',
        dataResponse(object),
      ),
      async (c) =>
        c.json({ data: await service.options(actor(c), await scoped(c)) }),
    );

    router.get(
      '/incidents',
      allowed('read'),
      describe(
        'hseIncidentList',
        'List HSE incidents',
        listResponse(object, pageMeta),
      ),
      apiValidator('query', hseIncidentQuery),
      async (c) =>
        c.json(
          await service.listIncidents(
            actor(c),
            c.req.valid('query'),
            await scoped(c),
          ),
        ),
    );

    router.post(
      '/incidents',
      allowed('manage'),
      describe(
        'hseIncidentCreate',
        'Create an HSE incident',
        dataResponse(object),
        201,
      ),
      apiValidator('json', hseIncidentCreate),
      async (c) =>
        c.json(
          {
            data: await service.createIncident(
              actor(c),
              c.req.valid('json'),
              await scoped(c),
            ),
          },
          201,
        ),
    );

    router.post(
      '/incidents/:id/transitions',
      allowedAny(['manage', 'approve']),
      describe(
        'hseIncidentTransition',
        'Advance an HSE incident through investigation, rectification or closure',
        dataResponse(object),
      ),
      apiValidator('param', hseIdParams),
      apiValidator('json', hseIncidentTransition),
      async (c) =>
        c.json({
          data: await service.transitionIncident(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.patch(
      '/incidents/:id',
      allowed('manage'),
      describe(
        'hseIncidentUpdate',
        'Update an HSE incident',
        dataResponse(object),
      ),
      apiValidator('param', hseIdParams),
      apiValidator('json', hseIncidentUpdate),
      async (c) =>
        c.json({
          data: await service.updateIncident(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.get(
      '/hazards',
      allowed('read'),
      describe(
        'hseHazardList',
        'List HSE hazards',
        listResponse(object, pageMeta),
      ),
      apiValidator('query', hseHazardQuery),
      async (c) =>
        c.json(
          await service.listHazards(
            actor(c),
            c.req.valid('query'),
            await scoped(c),
          ),
        ),
    );

    router.post(
      '/hazards',
      allowed('manage'),
      describe(
        'hseHazardCreate',
        'Create an HSE hazard',
        dataResponse(object),
        201,
      ),
      apiValidator('json', hseHazardCreate),
      async (c) =>
        c.json(
          {
            data: await service.createHazard(
              actor(c),
              c.req.valid('json'),
              await scoped(c),
            ),
          },
          201,
        ),
    );

    router.post(
      '/hazards/:id/transitions',
      allowedAny(['manage', 'approve']),
      describe(
        'hseHazardTransition',
        'Submit, verify, close or return an HSE hazard for correction',
        dataResponse(object),
      ),
      apiValidator('param', hseIdParams),
      apiValidator('json', hseHazardTransition),
      async (c) =>
        c.json({
          data: await service.transitionHazard(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.patch(
      '/hazards/:id',
      allowed('manage'),
      describe('hseHazardUpdate', 'Update an HSE hazard', dataResponse(object)),
      apiValidator('param', hseIdParams),
      apiValidator('json', hseHazardUpdate),
      async (c) =>
        c.json({
          data: await service.updateHazard(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );
    router.get(
      '/certificates',
      allowed('read'),
      describe(
        'hseCertificateList',
        'List HSE certificates with expiry status',
        listResponse(object, pageMeta),
      ),
      apiValidator('query', hseCertificateQuery),
      async (c) =>
        c.json(
          await service.listCertificates(
            actor(c),
            c.req.valid('query'),
            await scoped(c),
          ),
        ),
    );

    router.post(
      '/certificates',
      allowed('manage'),
      describe(
        'hseCertificateCreate',
        'Create an HSE certificate',
        dataResponse(object),
        201,
      ),
      apiValidator('json', hseCertificateCreate),
      async (c) =>
        c.json(
          {
            data: await service.createCertificate(
              actor(c),
              c.req.valid('json'),
              await scoped(c),
            ),
          },
          201,
        ),
    );

    router.post(
      '/certificates/:id/transitions',
      allowedAny(['manage', 'approve']),
      describe(
        'hseCertificateTransition',
        'Renew, revoke or reinstate an HSE certificate',
        dataResponse(object),
      ),
      apiValidator('param', hseIdParams),
      apiValidator('json', hseCertificateTransition),
      async (c) =>
        c.json({
          data: await service.transitionCertificate(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.patch(
      '/certificates/:id',
      allowed('manage'),
      describe(
        'hseCertificateUpdate',
        'Update an HSE certificate',
        dataResponse(object),
      ),
      apiValidator('param', hseIdParams),
      apiValidator('json', hseCertificateUpdate),
      async (c) =>
        c.json({
          data: await service.updateCertificate(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.get(
      '/operations-summary',
      allowed('read'),
      describe(
        'hseOperationsSummary',
        'Read the HSE metrics consumed by operations',
        dataResponse(object),
      ),
      async (c) =>
        c.json({
          data: await service.operationsSummary(actor(c), await scoped(c)),
        }),
    );

    const root = new Hono();
    root.route('/hse', router);
    return root;
  },
);

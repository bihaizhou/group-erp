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
import { databaseManagerToken } from '@nocobase/db';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import {
  hseCertificateCreate,
  hseCertificateQuery,
  hseCertificateTransition,
  hseCertificateUpdate,
  hseHazardCreate,
  hseHazardExportQuery,
  hseHazardQuery,
  hseHazardTransition,
  hseHazardUpdate,
  hseIdParams,
  hseIncidentCreate,
  hseIncidentExportQuery,
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
import {
  assertFieldsWritable,
  fieldPoliciesFor,
  redactRecord,
  redactRows,
  type FieldPolicyView,
} from '../providers/field-access.js';
import { resourceFieldNames } from '../providers/field-catalog.js';

type Env = AuthEnv & AuthorizationEnv;
/** Field-policy resources covering the HSE catalog fields. */
const INCIDENT_RESOURCE = 'hse.incident';
const HAZARD_RESOURCE = 'hse.hazard';
const CERTIFICATE_RESOURCE = 'hse.certificate';
/** Stored calendar-date columns; compare them by day, not by timestamp. */
const DATE_FIELDS = new Set(['discoveredAt', 'dueAt', 'issuedAt', 'expiresAt']);
/** Null and the empty string both mean "not provided" on an HSE form. */
const isProvided = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== '';
const asComparable = (field: string, value: unknown): string | null => {
  if (!isProvided(value)) return null;
  if (typeof value === 'boolean') return value ? '1' : '0';
  const text = String(value);
  return DATE_FIELDS.has(field) && text.length >= 10 ? text.slice(0, 10) : text;
};
/**
 * The raw JSON body of a request whose validator strips unknown keys.
 * Hono caches the parsed body, so this returns the same object the validator
 * read instead of consuming the request again.
 */
const requestBody = async (
  c: Context<Env>,
): Promise<Record<string, unknown>> => {
  try {
    const body: unknown = await c.req.json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
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
const exportMeta = z.object({ total: z.number(), truncated: z.boolean() });

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
    const db = app.container.resolve(databaseManagerToken);
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
        report: await result('report'),
      };
    };
    const allowed = (action: 'read' | 'manage' | 'approve' | 'report') =>
      createMiddleware<Env>(async (c, next) => {
        const result = await c.get('authz').authorize({
          resource: { type: 'settings', id: 'hse' },
          action,
        });
        if (result.effect === 'deny')
          throw new HseError('HSE_FORBIDDEN', 'PERMISSION_DENIED');
        await next();
      });
    const allowedAny = (
      actions: ('read' | 'manage' | 'approve' | 'report')[],
    ) =>
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
    /**
     * Field-policy write guard for the catalog fields present in a payload.
     * Runs only for accounts that actually have field policies, so the
     * no-policy path adds no catalog/previous reads and keeps its error order.
     */
    const rejectHiddenWrites = async (
      policies: FieldPolicyView[],
      resource: string,
      input: Record<string, unknown>,
      previous?: Record<string, unknown> | null,
    ) => {
      if (!policies.length) return;
      assertFieldsWritable(
        policies,
        resource,
        (await resourceFieldNames(db, resource)).filter((field) => {
          if (!(field in input) || !isProvided(input[field])) return false;
          return (
            !previous ||
            asComparable(field, input[field]) !==
              asComparable(field, previous[field])
          );
        }),
      );
    };
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
      apiValidator('query', hseOverviewQuery),
      describe(
        'hseOverview',
        'Read HSE overview counts and recent records',
        dataResponse(object),
      ),
      async (c) =>
        c.json({
          data: await service.overview(
            actor(c),
            await scoped(c),
            c.req.valid('query'),
          ),
        }),
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
      async (c) => {
        const principal = actor(c);
        const policies = await fieldPoliciesFor(db, principal);
        const result = await service.listIncidents(
          principal,
          c.req.valid('query'),
          await scoped(c),
        );
        return c.json({
          ...result,
          data: redactRows(result.data, policies, INCIDENT_RESOURCE),
        });
      },
    );

    router.get(
      '/incidents/export',
      allowed('read'),
      describe(
        'hseIncidentExport',
        'Export every HSE incident in scope for spreadsheets',
        listResponse(object, exportMeta, 'Success.'),
      ),
      apiValidator('query', hseIncidentExportQuery),
      async (c) => {
        const principal = actor(c);
        const policies = await fieldPoliciesFor(db, principal);
        const result = await service.exportIncidents(
          principal,
          c.req.valid('query'),
          await scoped(c),
        );
        return c.json({
          ...result,
          data: redactRows(result.data, policies, INCIDENT_RESOURCE),
        });
      },
    );

    router.post(
      '/incidents',
      allowedAny(['manage', 'report']),
      describe(
        'hseIncidentCreate',
        'Create an HSE incident',
        dataResponse(object),
        201,
      ),
      apiValidator('json', hseIncidentCreate),
      async (c) => {
        const principal = actor(c);
        const input = c.req.valid('json');
        const policies = await fieldPoliciesFor(db, principal);
        await rejectHiddenWrites(policies, INCIDENT_RESOURCE, input);
        const created = await service.createIncident(
          principal,
          input,
          await scoped(c),
        );
        return c.json(
          { data: redactRecord(created, policies, INCIDENT_RESOURCE) },
          201,
        );
      },
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
      async (c) => {
        const principal = actor(c);
        const policies = await fieldPoliciesFor(db, principal);
        const input = c.req.valid('json');
        // Some actions write catalog fields; enforce hidden-field write
        // policies before the transition runs.
        await rejectHiddenWrites(policies, INCIDENT_RESOURCE, input);
        const record = await service.transitionIncident(
          principal,
          c.req.valid('param').id,
          input,
          await scoped(c),
        );
        return c.json({
          data: redactRecord(record, policies, INCIDENT_RESOURCE),
        });
      },
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
      async (c) => {
        const principal = actor(c);
        const id = c.req.valid('param').id;
        const input = c.req.valid('json');
        const policies = await fieldPoliciesFor(db, principal);
        if (policies.length) {
          // The update schema has no location/description fields, so diff the
          // raw body: a submitted hidden field must be rejected even though
          // validation would otherwise strip it before the service call.
          const raw = await requestBody(c);
          const previous = (await db
            .repository('hseIncidents')
            .findOne({ filter: { id } })) as Record<string, unknown> | null;
          if (previous) {
            await rejectHiddenWrites(
              policies,
              INCIDENT_RESOURCE,
              raw,
              previous,
            );
          }
        }
        const updated = await service.updateIncident(
          principal,
          id,
          input,
          await scoped(c),
        );
        return c.json({
          data: redactRecord(updated, policies, INCIDENT_RESOURCE),
        });
      },
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
      async (c) => {
        const principal = actor(c);
        const policies = await fieldPoliciesFor(db, principal);
        const result = await service.listHazards(
          principal,
          c.req.valid('query'),
          await scoped(c),
        );
        return c.json({
          ...result,
          data: redactRows(result.data, policies, HAZARD_RESOURCE),
        });
      },
    );

    router.get(
      '/hazards/export',
      allowed('read'),
      describe(
        'hseHazardExport',
        'Export every HSE hazard in scope for spreadsheets',
        listResponse(object, exportMeta, 'Success.'),
      ),
      apiValidator('query', hseHazardExportQuery),
      async (c) => {
        const principal = actor(c);
        const policies = await fieldPoliciesFor(db, principal);
        const result = await service.exportHazards(
          principal,
          c.req.valid('query'),
          await scoped(c),
        );
        return c.json({
          ...result,
          data: redactRows(result.data, policies, HAZARD_RESOURCE),
        });
      },
    );

    router.post(
      '/hazards',
      allowedAny(['manage', 'report']),
      describe(
        'hseHazardCreate',
        'Create an HSE hazard',
        dataResponse(object),
        201,
      ),
      apiValidator('json', hseHazardCreate),
      async (c) => {
        const principal = actor(c);
        const input = c.req.valid('json');
        const policies = await fieldPoliciesFor(db, principal);
        await rejectHiddenWrites(policies, HAZARD_RESOURCE, input);
        const created = await service.createHazard(
          principal,
          input,
          await scoped(c),
        );
        return c.json(
          { data: redactRecord(created, policies, HAZARD_RESOURCE) },
          201,
        );
      },
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
      async (c) => {
        const principal = actor(c);
        const policies = await fieldPoliciesFor(db, principal);
        const input = c.req.valid('json');
        // Some actions write catalog fields; enforce hidden-field write
        // policies before the transition runs.
        await rejectHiddenWrites(policies, HAZARD_RESOURCE, input);
        const record = await service.transitionHazard(
          principal,
          c.req.valid('param').id,
          input,
          await scoped(c),
        );
        return c.json({
          data: redactRecord(record, policies, HAZARD_RESOURCE),
        });
      },
    );

    router.patch(
      '/hazards/:id',
      allowed('manage'),
      describe('hseHazardUpdate', 'Update an HSE hazard', dataResponse(object)),
      apiValidator('param', hseIdParams),
      apiValidator('json', hseHazardUpdate),
      async (c) => {
        const principal = actor(c);
        const id = c.req.valid('param').id;
        const input = c.req.valid('json');
        const policies = await fieldPoliciesFor(db, principal);
        if (policies.length) {
          // hseHazardUpdate has no location field; diff the raw body so a
          // submitted hidden field is rejected instead of silently stripped.
          const raw = await requestBody(c);
          const previous = (await db
            .repository('hseHazards')
            .findOne({ filter: { id } })) as Record<string, unknown> | null;
          if (previous) {
            await rejectHiddenWrites(policies, HAZARD_RESOURCE, raw, previous);
          }
        }
        const updated = await service.updateHazard(
          principal,
          id,
          input,
          await scoped(c),
        );
        return c.json({
          data: redactRecord(updated, policies, HAZARD_RESOURCE),
        });
      },
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
      async (c) => {
        const principal = actor(c);
        const policies = await fieldPoliciesFor(db, principal);
        const result = await service.listCertificates(
          principal,
          c.req.valid('query'),
          await scoped(c),
        );
        return c.json({
          ...result,
          data: redactRows(result.data, policies, CERTIFICATE_RESOURCE),
        });
      },
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
      async (c) => {
        const principal = actor(c);
        const input = c.req.valid('json');
        const policies = await fieldPoliciesFor(db, principal);
        await rejectHiddenWrites(policies, CERTIFICATE_RESOURCE, input);
        const created = await service.createCertificate(
          principal,
          input,
          await scoped(c),
        );
        return c.json(
          { data: redactRecord(created, policies, CERTIFICATE_RESOURCE) },
          201,
        );
      },
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
      async (c) => {
        const principal = actor(c);
        const policies = await fieldPoliciesFor(db, principal);
        const input = c.req.valid('json');
        // Some actions write catalog fields; enforce hidden-field write
        // policies before the transition runs.
        await rejectHiddenWrites(policies, CERTIFICATE_RESOURCE, input);
        const record = await service.transitionCertificate(
          principal,
          c.req.valid('param').id,
          input,
          await scoped(c),
        );
        return c.json({
          data: redactRecord(record, policies, CERTIFICATE_RESOURCE),
        });
      },
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
      async (c) => {
        const principal = actor(c);
        const id = c.req.valid('param').id;
        const input = c.req.valid('json');
        const policies = await fieldPoliciesFor(db, principal);
        if (policies.length) {
          const raw = await requestBody(c);
          const previous = (await db
            .repository('hseCertificates')
            .findOne({ filter: { id } })) as Record<string, unknown> | null;
          if (previous) {
            await rejectHiddenWrites(
              policies,
              CERTIFICATE_RESOURCE,
              raw,
              previous,
            );
          }
        }
        const updated = await service.updateCertificate(
          principal,
          id,
          input,
          await scoped(c),
        );
        return c.json({
          data: redactRecord(updated, policies, CERTIFICATE_RESOURCE),
        });
      },
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

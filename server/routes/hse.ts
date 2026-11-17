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
  hseActionCreate,
  hseActionQuery,
  hseActionTransition,
  hseActionUpdate,
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
  hseInspectionCreate,
  hseInspectionQuery,
  hseInspectionTransition,
  hseInspectionUpdate,
  hseOverviewQuery,
  hseTrainingRecordCreate,
  hseTrainingRecordQuery,
  hseTrainingRecordUpdate,
  hseWorkPermitCreate,
  hseWorkPermitQuery,
  hseWorkPermitTransition,
  hseWorkPermitUpdate,
} from '../providers/hse-model.js';
import {
  HseError,
  type HseScope,
  hseServiceToken,
} from '../providers/hse-service.js';
import {
  accessFor,
  assertFieldsWritable,
  redactRecord,
  redactRows,
  type FieldPolicyView,
} from '../providers/field-access.js';
import { resourceFieldNames } from '../providers/field-catalog.js';
import {
  pageFieldPoliciesFor,
} from '../providers/page-field-visibility.js';

type Env = AuthEnv & AuthorizationEnv;
/** Field-policy resources covering the HSE catalog fields. */
const INCIDENT_RESOURCE = 'hse.incident';
const HAZARD_RESOURCE = 'hse.hazard';
const CERTIFICATE_RESOURCE = 'hse.certificate';
const INSPECTION_RESOURCE = 'hse.inspection';
const WORK_PERMIT_RESOURCE = 'hse.workPermit';
const TRAINING_RESOURCE = 'hse.trainingRecord';
const ACTION_RESOURCE = 'hse.action';
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
      '/inspections',
      '/inspections/*',
      '/work-permits',
      '/work-permits/*',
      '/training-records',
      '/training-records/*',
      '/actions',
      '/actions/*',
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
    /**
     * PATCH bodies come from a form that echoes every visible field. A hidden
     * field is absent from the form, so the client sends `null`; silently
     * clearing the stored value would let a field policy destroy data. Hidden
     * fields are therefore dropped from the update, and a concrete value that
     * differs from the stored row is rejected as a hidden write.
     */
    const stripHiddenOnPatch = (
      policies: FieldPolicyView[],
      resource: string,
      input: Record<string, unknown>,
      previous: Record<string, unknown> | null,
    ) => {
      if (!policies.length) return;
      for (const [field, value] of Object.entries(input)) {
        if (accessFor(policies, resource, field) !== 'hidden') continue;
        if (value === null || value === undefined) {
          delete input[field];
          continue;
        }
        if (
          previous &&
          asComparable(field, value) === asComparable(field, previous[field])
        ) {
          delete input[field];
          continue;
        }
        assertFieldsWritable(policies, resource, [field]);
      }
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
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-incidents');
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
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-incidents');
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
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-incidents');
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
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-incidents');
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
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-incidents');
        if (policies.length) {
          // The update schema has no location/description fields, so diff the
          // raw body: a submitted hidden field must be rejected even though
          // validation would otherwise strip it before the service call.
          const raw = await requestBody(c);
          const previous = (await db
            .repository('hseIncidents')
            .findOne({ filter: { id } })) as Record<string, unknown> | null;
          if (previous) {
            stripHiddenOnPatch(policies, INCIDENT_RESOURCE, input, previous);
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
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-hazards');
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
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-hazards');
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
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-hazards');
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
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-hazards');
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
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-hazards');
        if (policies.length) {
          // hseHazardUpdate has no location field; diff the raw body so a
          // submitted hidden field is rejected instead of silently stripped.
          const raw = await requestBody(c);
          const previous = (await db
            .repository('hseHazards')
            .findOne({ filter: { id } })) as Record<string, unknown> | null;
          if (previous) {
            stripHiddenOnPatch(policies, HAZARD_RESOURCE, input, previous);
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
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-certificates');
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
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-certificates');
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
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-certificates');
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
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-certificates');
        if (policies.length) {
          const raw = await requestBody(c);
          const previous = (await db
            .repository('hseCertificates')
            .findOne({ filter: { id } })) as Record<string, unknown> | null;
          if (previous) {
            stripHiddenOnPatch(policies, CERTIFICATE_RESOURCE, input, previous);
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
      '/inspections',
      allowed('read'),
      describe(
        'hseInspectionList',
        'List HSE inspections',
        listResponse(object, pageMeta),
      ),
      apiValidator('query', hseInspectionQuery),
      async (c) => {
        const principal = actor(c);
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-inspections');
        const result = await service.listInspections(
          principal,
          c.req.valid('query'),
          await scoped(c),
        );
        return c.json({
          ...result,
          data: redactRows(result.data, policies, INSPECTION_RESOURCE),
        });
      },
    );

    router.post(
      '/inspections',
      allowed('manage'),
      describe(
        'hseInspectionCreate',
        'Create an HSE inspection',
        dataResponse(object),
        201,
      ),
      apiValidator('json', hseInspectionCreate),
      async (c) => {
        const principal = actor(c);
        const input = c.req.valid('json');
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-inspections');
        await rejectHiddenWrites(policies, INSPECTION_RESOURCE, input);
        const created = await service.createInspection(
          principal,
          input,
          await scoped(c),
        );
        return c.json(
          { data: redactRecord(created, policies, INSPECTION_RESOURCE) },
          201,
        );
      },
    );

    router.post(
      '/inspections/:id/transitions',
      allowed('manage'),
      describe(
        'hseInspectionTransition',
        'Complete an HSE inspection and record its findings',
        dataResponse(object),
      ),
      apiValidator('param', hseIdParams),
      apiValidator('json', hseInspectionTransition),
      async (c) => {
        const principal = actor(c);
        const input = c.req.valid('json');
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-inspections');
        await rejectHiddenWrites(policies, INSPECTION_RESOURCE, input);
        const record = await service.transitionInspection(
          principal,
          c.req.valid('param').id,
          input,
          await scoped(c),
        );
        return c.json({
          data: redactRecord(record, policies, INSPECTION_RESOURCE),
        });
      },
    );

    router.patch(
      '/inspections/:id',
      allowed('manage'),
      describe(
        'hseInspectionUpdate',
        'Update a planned HSE inspection',
        dataResponse(object),
      ),
      apiValidator('param', hseIdParams),
      apiValidator('json', hseInspectionUpdate),
      async (c) => {
        const principal = actor(c);
        const input = c.req.valid('json');
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-inspections');
        const previous = policies.length
          ? ((await db
              .repository('hseInspections')
              .findOne({ filter: { id: c.req.valid('param').id } })) as
              | Record<string, unknown>
              | null)
          : null;
        stripHiddenOnPatch(policies, INSPECTION_RESOURCE, input, previous);
        await rejectHiddenWrites(policies, INSPECTION_RESOURCE, input, previous);
        const updated = await service.updateInspection(
          principal,
          c.req.valid('param').id,
          input,
          await scoped(c),
        );
        return c.json({
          data: redactRecord(updated, policies, INSPECTION_RESOURCE),
        });
      },
    );

    router.get(
      '/work-permits',
      allowed('read'),
      describe(
        'hseWorkPermitList',
        'List HSE work permits',
        listResponse(object, pageMeta),
      ),
      apiValidator('query', hseWorkPermitQuery),
      async (c) => {
        const principal = actor(c);
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-work-permits');
        const result = await service.listWorkPermits(
          principal,
          c.req.valid('query'),
          await scoped(c),
        );
        return c.json({
          ...result,
          data: redactRows(result.data, policies, WORK_PERMIT_RESOURCE),
        });
      },
    );

    router.post(
      '/work-permits',
      allowed('manage'),
      describe(
        'hseWorkPermitCreate',
        'Create an HSE work permit',
        dataResponse(object),
        201,
      ),
      apiValidator('json', hseWorkPermitCreate),
      async (c) => {
        const principal = actor(c);
        const input = c.req.valid('json');
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-work-permits');
        await rejectHiddenWrites(policies, WORK_PERMIT_RESOURCE, input);
        const created = await service.createWorkPermit(
          principal,
          input,
          await scoped(c),
        );
        return c.json(
          { data: redactRecord(created, policies, WORK_PERMIT_RESOURCE) },
          201,
        );
      },
    );

    router.post(
      '/work-permits/:id/transitions',
      allowedAny(['manage', 'approve']),
      describe(
        'hseWorkPermitTransition',
        'Submit, approve, reject or close an HSE work permit',
        dataResponse(object),
      ),
      apiValidator('param', hseIdParams),
      apiValidator('json', hseWorkPermitTransition),
      async (c) => {
        const principal = actor(c);
        const input = c.req.valid('json');
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-work-permits');
        await rejectHiddenWrites(policies, WORK_PERMIT_RESOURCE, input);
        const record = await service.transitionWorkPermit(
          principal,
          c.req.valid('param').id,
          input,
          await scoped(c),
        );
        return c.json({
          data: redactRecord(record, policies, WORK_PERMIT_RESOURCE),
        });
      },
    );

    router.patch(
      '/work-permits/:id',
      allowed('manage'),
      describe(
        'hseWorkPermitUpdate',
        'Update a draft HSE work permit',
        dataResponse(object),
      ),
      apiValidator('param', hseIdParams),
      apiValidator('json', hseWorkPermitUpdate),
      async (c) => {
        const principal = actor(c);
        const input = c.req.valid('json');
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-work-permits');
        const previous = policies.length
          ? ((await db
              .repository('hseWorkPermits')
              .findOne({ filter: { id: c.req.valid('param').id } })) as
              | Record<string, unknown>
              | null)
          : null;
        stripHiddenOnPatch(policies, WORK_PERMIT_RESOURCE, input, previous);
        await rejectHiddenWrites(policies, WORK_PERMIT_RESOURCE, input, previous);
        const updated = await service.updateWorkPermit(
          principal,
          c.req.valid('param').id,
          input,
          await scoped(c),
        );
        return c.json({
          data: redactRecord(updated, policies, WORK_PERMIT_RESOURCE),
        });
      },
    );

    router.get(
      '/training-records',
      allowed('read'),
      describe(
        'hseTrainingRecordList',
        'List HSE training records',
        listResponse(object, pageMeta),
      ),
      apiValidator('query', hseTrainingRecordQuery),
      async (c) => {
        const principal = actor(c);
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-training-records');
        const result = await service.listTrainingRecords(
          principal,
          c.req.valid('query'),
          await scoped(c),
        );
        return c.json({
          ...result,
          data: redactRows(result.data, policies, TRAINING_RESOURCE),
        });
      },
    );

    router.post(
      '/training-records',
      allowed('manage'),
      describe(
        'hseTrainingRecordCreate',
        'Create an HSE training record',
        dataResponse(object),
        201,
      ),
      apiValidator('json', hseTrainingRecordCreate),
      async (c) => {
        const principal = actor(c);
        const input = c.req.valid('json');
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-training-records');
        await rejectHiddenWrites(policies, TRAINING_RESOURCE, input);
        const created = await service.createTrainingRecord(
          principal,
          input,
          await scoped(c),
        );
        return c.json(
          { data: redactRecord(created, policies, TRAINING_RESOURCE) },
          201,
        );
      },
    );

    router.patch(
      '/training-records/:id',
      allowed('manage'),
      describe(
        'hseTrainingRecordUpdate',
        'Update an HSE training record',
        dataResponse(object),
      ),
      apiValidator('param', hseIdParams),
      apiValidator('json', hseTrainingRecordUpdate),
      async (c) => {
        const principal = actor(c);
        const input = c.req.valid('json');
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-training-records');
        const previous = policies.length
          ? ((await db
              .repository('hseTrainingRecords')
              .findOne({ filter: { id: c.req.valid('param').id } })) as
              | Record<string, unknown>
              | null)
          : null;
        stripHiddenOnPatch(policies, TRAINING_RESOURCE, input, previous);
        await rejectHiddenWrites(policies, TRAINING_RESOURCE, input, previous);
        const updated = await service.updateTrainingRecord(
          principal,
          c.req.valid('param').id,
          input,
          await scoped(c),
        );
        return c.json({
          data: redactRecord(updated, policies, TRAINING_RESOURCE),
        });
      },
    );

    router.get(
      '/actions',
      allowed('read'),
      describe(
        'hseActionList',
        'List HSE corrective actions',
        listResponse(object, pageMeta),
      ),
      apiValidator('query', hseActionQuery),
      async (c) => {
        const principal = actor(c);
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-actions');
        const result = await service.listActions(
          principal,
          c.req.valid('query'),
          await scoped(c),
        );
        return c.json({
          ...result,
          data: redactRows(result.data, policies, ACTION_RESOURCE),
        });
      },
    );

    router.post(
      '/actions',
      allowedAny(['manage', 'report']),
      describe(
        'hseActionCreate',
        'Create an HSE corrective action',
        dataResponse(object),
        201,
      ),
      apiValidator('json', hseActionCreate),
      async (c) => {
        const principal = actor(c);
        const input = c.req.valid('json');
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-actions');
        await rejectHiddenWrites(policies, ACTION_RESOURCE, input);
        const created = await service.createAction(
          principal,
          input,
          await scoped(c),
        );
        return c.json(
          { data: redactRecord(created, policies, ACTION_RESOURCE) },
          201,
        );
      },
    );

    router.post(
      '/actions/:id/transitions',
      allowedAny(['manage', 'approve']),
      describe(
        'hseActionTransition',
        'Complete or verify an HSE corrective action',
        dataResponse(object),
      ),
      apiValidator('param', hseIdParams),
      apiValidator('json', hseActionTransition),
      async (c) => {
        const principal = actor(c);
        const input = c.req.valid('json');
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-actions');
        await rejectHiddenWrites(policies, ACTION_RESOURCE, input);
        const record = await service.transitionAction(
          principal,
          c.req.valid('param').id,
          input,
          await scoped(c),
        );
        return c.json({
          data: redactRecord(record, policies, ACTION_RESOURCE),
        });
      },
    );

    router.patch(
      '/actions/:id',
      allowed('manage'),
      describe(
        'hseActionUpdate',
        'Update an open HSE corrective action',
        dataResponse(object),
      ),
      apiValidator('param', hseIdParams),
      apiValidator('json', hseActionUpdate),
      async (c) => {
        const principal = actor(c);
        const input = c.req.valid('json');
        const policies = await pageFieldPoliciesFor(db, principal, 'hse-actions');
        const previous = policies.length
          ? ((await db
              .repository('hseActions')
              .findOne({ filter: { id: c.req.valid('param').id } })) as
              | Record<string, unknown>
              | null)
          : null;
        stripHiddenOnPatch(policies, ACTION_RESOURCE, input, previous);
        await rejectHiddenWrites(policies, ACTION_RESOURCE, input, previous);
        const updated = await service.updateAction(
          principal,
          c.req.valid('param').id,
          input,
          await scoped(c),
        );
        return c.json({
          data: redactRecord(updated, policies, ACTION_RESOURCE),
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

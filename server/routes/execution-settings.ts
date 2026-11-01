import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { createMiddleware } from 'hono/factory';
import { bodyLimit } from 'hono/body-limit';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  describeRoute,
  apiValidator,
  dataResponse,
  listResponse,
  apiErrorResponses,
  apiErrorResponse,
  apiErrorHandler,
  ApiError,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import type { MaterialPolicies } from '../providers/material-service.js';
import {
  executionReviewServiceToken,
  executionRecordsToken,
} from '../providers/execution.js';
import {
  executionSettingsQuery,
  executionSettingsSave,
  executionProjection,
  executionMeta,
  executionPage,
} from '../providers/execution-model.js';
import {
  executionRepo as repo,
  executionCompany,
  executionActor,
  executionText as text,
} from '../providers/execution-access.js';
import { materialIdFilter } from '../providers/material-filters.js';
import { inventoryError as fail } from '../providers/inventory-quantity.js';
import { executionApiError } from './execution-error.js';

type Env = AuthEnv &
  AuthorizationEnv & { Variables: { executionPolicies: MaterialPolicies } };
export const executionSettingsRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const router = new Hono<Env>(),
      auth = app.container.resolve(authenticationToken),
      authz = app.container.resolve(authorizationToken),
      reviews = app.container.resolve(executionReviewServiceToken),
      records = app.container.resolve(executionRecordsToken),
      policies = (c: Context<Env>) => c.get('executionPolicies'),
      actor = (c: Context<Env>) => c.get('auth')!.user.id,
      allowed = (action: string) =>
        createMiddleware<Env>(async (c, next) => {
          const value = await c.get('authz').authorize({
            resource: { type: 'composite', id: 'warehouse.settings' },
            action,
          });
          if (value.effect === 'deny' || !value.conditions?.database)
            return fail('STOCK_FORBIDDEN');
          c.set('executionPolicies', value.conditions.database);
          await next();
        }),
      describe = (
        name: string,
        summary: string,
        response: ReturnType<typeof dataResponse>,
      ) =>
        describeRoute({
          operationId: `executionSettings${name}`,
          summary,
          tags: ['Execution review settings'],
          responses: {
            '200': response,
            ...apiErrorResponses,
            '400': apiErrorResponse(400),
            '409': apiErrorResponse(409),
            '413': apiErrorResponse(413),
          },
        });
    router.use('/warehouse/settings', auth.required(), authz.middleware());
    router.use('/warehouse/settings/*', auth.required(), authz.middleware());
    router.onError((error, c) => apiErrorHandler(executionApiError(error), c));
    const references = async (
      c: import('@nocobase/db').DatabaseConnection,
      selections: unknown,
      p: MaterialPolicies,
    ) =>
      Promise.all(
        (Array.isArray(selections) ? selections : []).map(async (raw) => {
          const selection = raw as {
              type: 'position' | 'user';
              referenceId: string;
              group: number;
            },
            row =
              selection.type === 'position'
                ? await repo(c, 'orgPositions', p).findOne({
                    filter: { id: selection.referenceId },
                  })
                : await repo(c, 'personnelEmployees', p).findOne({
                    filter: { accountId: selection.referenceId },
                  });
          return {
            ...selection,
            code: row?.code ?? null,
            name: row?.name ?? null,
            availability: row
              ? row.status === 'active'
                ? 'active'
                : 'inactive'
              : 'unavailable',
          };
        }),
      );
    router.get(
      '/warehouse/settings',
      allowed('read'),
      describe(
        'Read',
        'Read one company and one independently saved review card',
        dataResponse(executionProjection),
      ),
      apiValidator('query', executionSettingsQuery),
      async (c) => {
        const q = c.req.valid('query'),
          conn = records.db.connection();
        await executionCompany(conn, q.subjectId, policies(c), false);
        return c.json({
          data: await records.db.transaction(async (tx) => {
            const value = await reviews.settings(tx, q.kind, q.subjectId);
            return {
              ...value,
              references: await references(
                tx,
                value.values.reviewerSelections,
                policies(c),
              ),
            };
          }),
        });
      },
    );
    router.put(
      '/warehouse/settings',
      allowed('update'),
      bodyLimit({
        maxSize: 65536,
        onError: () => {
          throw new ApiError({
            status: 'INVALID_ARGUMENT',
            httpStatus: 413,
            domain: 'inventory',
            reason: 'BODY_TOO_LARGE',
            message: 'Payload too large.',
          });
        },
      }),
      describe(
        'Save',
        'Save one complete review card using its expected revision and request key',
        dataResponse(executionProjection),
      ),
      apiValidator('json', executionSettingsSave),
      async (c) => {
        const input = c.req.valid('json'),
          p = policies(c),
          data = await records.db.transaction(async (tx) => {
            await executionActor(tx, records.users, actor(c));
            await records.masterLock(tx);
            await executionCompany(tx, input.subjectId, p);
            for (const selection of input.values.reviewerSelections) {
              const exists =
                selection.type === 'position'
                  ? await repo(tx, 'orgPositions', p).exists({
                      filter: { id: selection.referenceId, status: 'active' },
                    })
                  : await repo(tx, 'personnelEmployees', p).exists({
                      filter: {
                        accountId: selection.referenceId,
                        status: 'active',
                      },
                    });
              if (!exists)
                return fail(
                  'STOCK_REVIEW_REFERENCE_UNAVAILABLE',
                  'reviewerSelections',
                );
            }
            const saved = await reviews.saveSettings(
              tx,
              input.kind,
              input.subjectId,
              input.values,
              input.version,
              actor(c),
              input.requestKey,
            );
            return {
              ...saved,
              references: await references(
                tx,
                saved.values.reviewerSelections,
                p,
              ),
            };
          });
        return c.json({ data });
      },
    );
    router.get(
      '/warehouse/settings/companies',
      allowed('read'),
      describe(
        'Companies',
        'Search authorized review companies',
        listResponse(executionProjection, executionMeta),
      ),
      apiValidator('query', executionPage),
      async (c) => {
        const q = c.req.valid('query'),
          scoped = repo(records.db.connection(), 'orgSubjects', policies(c)),
          filter = (f: import('@nocobase/db').FilterBuilder) =>
            f.and([
              f.string('status').eq('active'),
              ...(q.q
                ? [
                    f.or([
                      f.string('code').includes(q.q, { mode: 'insensitive' }),
                      f.string('name').includes(q.q, { mode: 'insensitive' }),
                    ]),
                  ]
                : []),
            ]);
        return c.json({
          data: (
            await scoped.findMany({
              filter,
              limit: q.pageSize,
              offset: (q.page - 1) * q.pageSize,
              sort: (s) => [s.field('code').asc()],
            })
          ).map((row) => ({ id: row.id, code: row.code, name: row.name })),
          meta: {
            page: q.page,
            pageSize: q.pageSize,
            total: await scoped.count({ filter }),
          },
        });
      },
    );
    router.get(
      '/warehouse/settings/options',
      allowed('read'),
      describe(
        'Options',
        'Search minimal active company approval positions or human accounts',
        listResponse(executionProjection, executionMeta),
      ),
      apiValidator(
        'query',
        executionPage.extend({
          subjectId: z.string().uuid(),
          kind: z.enum(['positions', 'reviewers']),
        }),
      ),
      async (c) => {
        const q = c.req.valid('query'),
          conn = records.db.connection(),
          p = policies(c);
        await executionCompany(conn, q.subjectId, p);
        const match = (f: import('@nocobase/db').FilterBuilder) =>
          q.q
            ? [
                f.or([
                  f.string('code').includes(q.q, { mode: 'insensitive' }),
                  f.string('name').includes(q.q, { mode: 'insensitive' }),
                ]),
              ]
            : [];
        if (q.kind === 'positions') {
          const units = await repo(conn, 'orgUnits', p).findMany({
            filter: { subjectId: q.subjectId, status: 'active' },
            limit: 10001,
          });
          if (units.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
          const scoped = repo(conn, 'orgPositions', p),
            filter = (f: import('@nocobase/db').FilterBuilder) =>
              f.and([
                f.string('status').eq('active'),
                materialIdFilter(
                  f,
                  'unitId',
                  units.map((row) => text(row.id)),
                ),
                ...match(f),
              ]);
          return c.json({
            data: (
              await scoped.findMany({
                filter,
                limit: q.pageSize,
                offset: (q.page - 1) * q.pageSize,
                sort: (s) => [s.field('code').asc()],
              })
            ).map((row) => ({ id: row.id, code: row.code, name: row.name })),
            meta: {
              page: q.page,
              pageSize: q.pageSize,
              total: await scoped.count({ filter }),
            },
          });
        }
        const people = await repo(conn, 'personnelEmployees', p).findMany({
          filter: (f) => f.and([f.string('status').eq('active'), ...match(f)]),
          limit: 10001,
          sort: (s) => [s.field('code').asc()],
        });
        if (people.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
        const rows = [];
        for (const person of people)
          if (
            person.accountId &&
            (await reviews.reviewers.eligible(
              conn,
              text(person.accountId),
              q.subjectId,
            ))
          )
            rows.push({
              id: person.accountId,
              code: person.code,
              name: person.name,
            });
        return c.json({
          data: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
          meta: { page: q.page, pageSize: q.pageSize, total: rows.length },
        });
      },
    );
    const root = new Hono();
    root.route('/', router);
    return root;
  });

import { businessDate } from '../providers/business-date.js';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import { databaseManagerToken } from '@nocobase/db';
import { fieldPoliciesFor, redactRows } from '../providers/field-access.js';
import {
  defineApiRoutes,
  apiValidator,
  describeRoute,
  dataResponse,
  listResponse,
  apiErrorResponses,
  apiErrorResponse,
  apiErrorHandler,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { executionApiError } from './execution-error.js';
import type { MaterialPolicies } from '../providers/material-service.js';
import {
  executionRecordsToken,
  inventoryReadServiceToken,
} from '../providers/execution.js';
import {
  inventoryQuery,
  inventoryMovementQuery,
  inventoryReservationsQuery,
  inventoryReservationInput,
  inventoryReleaseInput,
  executionParams,
  executionPage,
  executionProjection,
  executionMeta,
} from '../providers/execution-model.js';
import {
  executionRepo as repo,
  executionCompany,
} from '../providers/execution-access.js';
import { inventoryError as fail } from '../providers/inventory-quantity.js';
import { warehouseSources } from '../providers/warehouse-sources.js';
type Env = AuthEnv &
  AuthorizationEnv & { Variables: { executionPolicies: MaterialPolicies } };
export const inventoryRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const router = new Hono<Env>(),
      auth = app.container.resolve(authenticationToken),
      authz = app.container.resolve(authorizationToken),
      service = app.container.resolve(inventoryReadServiceToken),
      db = app.container.resolve(databaseManagerToken),
      records = app.container.resolve(executionRecordsToken),
      base = '/warehouse/inventory',
      p = (c: Context<Env>) => c.get('executionPolicies'),
      actor = (c: Context<Env>) => ({ id: c.get('auth')!.user.id }),
      errors = {
        ...apiErrorResponses,
        '400': apiErrorResponse(400),
        '404': apiErrorResponse(404),
        '409': apiErrorResponse(409),
      },
      allowed = (action: string) =>
        createMiddleware<Env>(async (c, next) => {
          const decision = await c.get('authz').authorize({
            resource: { type: 'composite', id: 'warehouse.inventory' },
            action,
          });
          if (decision.effect === 'deny' || !decision.conditions?.database)
            return fail('STOCK_FORBIDDEN');
          c.set('executionPolicies', decision.conditions.database);
          await next();
        }),
      describe = (name: string, summary: string, list = true) =>
        describeRoute({
          operationId: `inventory${name}`,
          summary,
          tags: ['Inventory quantities'],
          responses: {
            200: list
              ? listResponse(executionProjection, executionMeta)
              : dataResponse(executionProjection),
            ...errors,
          },
        });
    router.onError((error, c) => apiErrorHandler(executionApiError(error), c));
    router.use(base, auth.required(), authz.middleware());
    router.use(`${base}/*`, auth.required(), authz.middleware());
    router.get(
      `${base}/companies`,
      allowed('read'),
      describe('Companies', 'Search authorized companies'),
      apiValidator('query', executionPage),
      async (c) => {
        const q = c.req.valid('query'),
          scoped = repo(records.db.connection(), 'orgSubjects', p(c)),
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
            businessDate: businessDate(records.timeZone),
            page: q.page,
            pageSize: q.pageSize,
            total: await scoped.count({ filter }),
          },
        });
      },
    );
    router.get(
      `${base}/warehouses`,
      allowed('read'),
      describe('Warehouses', 'Search authorized company warehouses'),
      apiValidator(
        'query',
        executionPage.extend({ subjectId: z.string().uuid() }),
      ),
      async (c) => {
        const q = c.req.valid('query'),
          cdb = records.db.connection();
        await executionCompany(cdb, q.subjectId, p(c));
        const scoped = repo(cdb, 'warehouses', p(c)),
          filter = (f: import('@nocobase/db').FilterBuilder) =>
            f.and([
              f.string('subjectId').eq(q.subjectId),
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
            businessDate: businessDate(records.timeZone),
            page: q.page,
            pageSize: q.pageSize,
            total: await scoped.count({ filter }),
          },
        });
      },
    );
    router.get(
      base,
      allowed('read'),
      describe('List', 'Read exact stock dimensions without cross-SKU totals'),
      apiValidator('query', inventoryQuery),
      async (c) => {
        const result = await service.list(c.req.valid('query'), p(c));
        const policies = await fieldPoliciesFor(db, {
          type: 'user',
          id: actor(c).id,
        });
        return c.json({
          ...result,
          data: redactRows(
            result.data as Record<string, unknown>[],
            policies,
            'warehouse.inventory.balance',
          ),
        });
      },
    );
    router.get(
      `${base}/reconcile`,
      allowed('reconcile'),
      describe(
        'Reconcile',
        'Compare balances with immutable movements and reservation facts without rewriting',
      ),
      apiValidator('query', inventoryQuery),
      async (c) => c.json(await service.reconcile(c.req.valid('query'), p(c))),
    );
    router.get(
      `${base}/movements`,
      allowed('read'),
      describe(
        'Movements',
        'Read immutable warehouse and typed transit movements',
      ),
      apiValidator('query', inventoryMovementQuery),
      async (c) =>
        c.json(
          await service.facts('stockMovements', c.req.valid('query'), p(c)),
        ),
    );
    router.get(
      `${base}/reservations`,
      allowed('read'),
      describe(
        'Reservations',
        'Read scoped source reservations and remaining quantities',
      ),
      apiValidator('query', inventoryReservationsQuery),
      async (c) =>
        c.json(
          await service.facts('stockReservations', c.req.valid('query'), p(c)),
        ),
    );
    router.post(
      `${base}/reservations`,
      allowed('reserve'),
      describe(
        'Reserve',
        'Reserve qualified stock against an actual approved source',
        false,
      ),
      apiValidator('json', inventoryReservationInput),
      async (c) =>
        c.json({
          data: await service.reserve(c.req.valid('json'), actor(c), p(c)),
        }),
    );
    router.post(
      `${base}/reservations/:id/release`,
      allowed('release'),
      describe(
        'Release',
        'Release an exact reservation remainder with current scope and version',
        false,
      ),
      apiValidator('param', executionParams),
      apiValidator('json', inventoryReleaseInput),
      async (c) =>
        c.json({
          data: await service.release(
            c.req.valid('param').id,
            c.req.valid('json'),
            actor(c),
            p(c),
          ),
        }),
    );
    router.get(
      `${base}/balances/:id`,
      allowed('read'),
      describe('Balance', 'Read one actual authorized stock dimension', false),
      apiValidator('param', executionParams),
      async (c) =>
        c.json({ data: await service.balance(c.req.valid('param').id, p(c)) }),
    );
    router.get(
      `${base}/reservations/:id`,
      allowed('read'),
      describe(
        'Reservation',
        'Read one actual reservation and its base unit',
        false,
      ),
      apiValidator('param', executionParams),
      async (c) =>
        c.json({
          data: await service.reservation(c.req.valid('param').id, p(c)),
        }),
    );
    router.get(
      `${base}/sourceOptions`,
      allowed('reserve'),
      describe(
        'SourceOptions',
        'Read minimal approved issue and sales sources for reservation',
      ),
      apiValidator(
        'query',
        executionPage.extend({
          subjectId: z.string().uuid(),
          warehouseId: z.string().uuid(),
          kind: z.enum(['issue', 'salesShipment']),
          sourceId: z.string().uuid().optional(),
        }),
      ),
      async (c) =>
        c.json(
          await warehouseSources(
            records.db.connection(),
            c.req.valid('query'),
            p(c),
          ),
        ),
    );
    router.get(
      `${base}/transferOptions`,
      allowed('read'),
      describe(
        'TransferOptions',
        'Search authorized transfer codes without opening full transfers',
      ),
      apiValidator(
        'query',
        executionPage.extend({ subjectId: z.string().uuid() }),
      ),
      async (c) => {
        const q = c.req.valid('query'),
          conn = records.db.connection();
        await executionCompany(conn, q.subjectId, p(c), false);
        const scoped = repo(conn, 'stockTransfers', p(c)),
          filter = (f: import('@nocobase/db').FilterBuilder) =>
            f.and([
              f.string('subjectId').eq(q.subjectId),
              ...(q.q
                ? [f.string('code').includes(q.q, { mode: 'insensitive' })]
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
          ).map((row) => ({ id: row.id, code: row.code })),
          meta: {
            page: q.page,
            pageSize: q.pageSize,
            total: await scoped.count({ filter }),
          },
        });
      },
    );
    const root = new Hono();
    root.route('/', router);
    return root;
  });

import { businessDate } from '../providers/business-date.js';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { bodyLimit } from 'hono/body-limit';
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
import {
  defineApiRoutes,
  apiValidator,
  describeRoute,
  dataResponse,
  listResponse,
  apiErrorResponses,
  apiErrorResponse,
  apiErrorHandler,
  ApiError,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { executionApiError } from './execution-error.js';
import type { MaterialPolicies } from '../providers/material-service.js';
import {
  executionRecordsToken,
  tradeOrderServiceToken,
  customerServiceToken,
} from '../providers/execution.js';
import { supplierServiceToken } from '../providers/procurement.js';
import { supplyChainMaterialServiceToken } from '../providers/supply-chain.js';
import { executionResourceIds } from '../providers/execution-resources.js';
import {
  executionPage,
  executionQuery,
  executionParams,
  executionMeta,
  executionProjection,
  orderCreate,
  orderUpdate,
  executionMutation,
  executionQuantityAction,
} from '../providers/execution-model.js';
import {
  materialOptionsQuery,
  materialOptionsMeta,
  materialSelectionInput,
} from '../providers/supply-chain-model.js';
import {
  executionRepo as repo,
  executionText as text,
  executionCompany,
} from '../providers/execution-access.js';
import {
  inventoryError as fail,
  stockMicros,
  stockQuantity,
} from '../providers/inventory-quantity.js';
import { materialIdFilter } from '../providers/material-filters.js';
import type { TradeKind } from '../providers/trade-order-service.js';

type Env = AuthEnv &
  AuthorizationEnv & { Variables: { executionPolicies: MaterialPolicies } };
export const tradeOrderRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const router = new Hono<Env>(),
      auth = app.container.resolve(authenticationToken),
      authz = app.container.resolve(authorizationToken),
      service = app.container.resolve(tradeOrderServiceToken),
      records = app.container.resolve(executionRecordsToken),
      materials = app.container.resolve(supplyChainMaterialServiceToken),
      actor = (c: Context<Env>) => ({ id: c.get('auth')!.user.id }),
      policies = (c: Context<Env>) => c.get('executionPolicies'),
      errors = {
        ...apiErrorResponses,
        '400': apiErrorResponse(400),
        '404': apiErrorResponse(404),
        '409': apiErrorResponse(409),
        '413': apiErrorResponse(413),
      },
      limit = bodyLimit({
        maxSize: 1048576,
        onError: () => {
          throw new ApiError({
            httpStatus: 413,
            status: 'INVALID_ARGUMENT',
            domain: 'inventory',
            reason: 'BODY_TOO_LARGE',
            message: 'Payload too large.',
          });
        },
      });
    router.onError((error, c) => {
      return apiErrorHandler(executionApiError(error), c);
    });
    const allowed = (kind: TradeKind, action: string) =>
      createMiddleware<Env>(async (c, next) => {
        const decision = await c.get('authz').authorize({
          resource: { type: 'composite', id: executionResourceIds[kind] },
          action,
        });
        if (decision.effect === 'deny' || !decision.conditions?.database)
          return fail('STOCK_FORBIDDEN');
        c.set('executionPolicies', decision.conditions.database);
        await next();
      });
    const describe = (
      kind: TradeKind,
      name: string,
      summary: string,
      response: ReturnType<typeof dataResponse>,
      create = false,
    ) =>
      describeRoute({
        operationId: `${kind}${name}`,
        summary,
        tags: [
          kind === 'purchaseOrders'
            ? 'Purchase quantity orders'
            : 'Sales quantity orders',
        ],
        responses: { [create ? '201' : '200']: response, ...errors },
      });
    for (const [kind, base] of [
      ['purchaseOrders', '/procurement/orders'],
      ['salesOrders', '/sales/orders'],
    ] as const) {
      router.use(base, auth.required(), authz.middleware());
      router.use(`${base}/*`, auth.required(), authz.middleware());
      router.get(
        `${base}/companies`,
        allowed(kind, 'read'),
        describe(
          kind,
          'Companies',
          'Search authorized trading companies',
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
              ]),
            rows = await scoped.findMany({
              filter,
              sort: (s) => [s.field('code').asc()],
              limit: q.pageSize,
              offset: (q.page - 1) * q.pageSize,
            });
          return c.json({
            data: rows.map((row) => ({
              id: row.id,
              code: row.code,
              name: row.name,
            })),
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
        allowed(kind, 'read'),
        describe(
          kind,
          'Warehouses',
          'Search active authorized warehouses',
          listResponse(executionProjection, executionMeta),
        ),
        apiValidator(
          'query',
          executionPage.extend({ subjectId: z.string().uuid() }),
        ),
        async (c) => {
          const q = c.req.valid('query'),
            conn = records.db.connection();
          await executionCompany(conn, q.subjectId, policies(c));
          const scoped = repo(conn, 'warehouses', policies(c)),
            filter = (f: import('@nocobase/db').FilterBuilder) =>
              f.and([
                f.string('subjectId').eq(q.subjectId),
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
                sort: (s) => [s.field('code').asc()],
                limit: q.pageSize,
                offset: (q.page - 1) * q.pageSize,
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
        `${base}/partnerOptions`,
        allowed(kind, 'read'),
        describe(
          kind,
          'PartnerOptions',
          'Search qualified suppliers or customers for this company',
          listResponse(executionProjection, executionMeta),
        ),
        apiValidator(
          'query',
          executionPage.extend({ subjectId: z.string().uuid() }),
        ),
        async (c) => {
          const q = c.req.valid('query'),
            partner = app.container.resolve(
              kind === 'purchaseOrders'
                ? supplierServiceToken
                : customerServiceToken,
            ),
            result = await partner.availability(
              { ...q, status: 'active', orderBy: 'code' },
              policies(c),
            );
          return c.json({
            data: result.data.map((row) => ({
              id: row.partnerId,
              code: row.identity.code,
              name: row.identity.name,
            })),
            meta: result.meta,
          });
        },
      );
      router.get(
        `${base}/materialOptions`,
        allowed(kind, 'read'),
        describe(
          kind,
          'MaterialOptions',
          'Search company admitted confirmed materials',
          listResponse(executionProjection, materialOptionsMeta),
        ),
        apiValidator('query', materialOptionsQuery),
        async (c) =>
          c.json(
            await materials.options(
              kind === 'purchaseOrders' ? 'procurement' : 'sales',
              c.req.valid('query'),
              policies(c),
            ),
          ),
      );
      router.get(
        `${base}/materialOptions/:id`,
        allowed(kind, 'read'),
        describe(
          kind,
          'MaterialOption',
          'Read an eligible material and exact unit rules',
          dataResponse(executionProjection),
        ),
        apiValidator('param', executionParams),
        apiValidator('query', z.strictObject({ subjectId: z.string().uuid() })),
        async (c) =>
          c.json(
            await materials.detail(
              kind === 'purchaseOrders' ? 'procurement' : 'sales',
              c.req.valid('query').subjectId,
              c.req.valid('param').id,
              policies(c),
            ),
          ),
      );
      router.post(
        `${base}/materialSelections`,
        allowed(kind, 'read'),
        limit,
        describe(
          kind,
          'MaterialSelection',
          'Preview exact quantity without writing quantity or coordination facts',
          dataResponse(executionProjection),
        ),
        apiValidator('json', materialSelectionInput),
        async (c) =>
          c.json({
            data: await records.db.transaction((conn) =>
              materials.previewSelectionInTransaction(
                conn,
                kind === 'purchaseOrders' ? 'procurement' : 'sales',
                c.req.valid('json'),
                policies(c),
              ),
            ),
          }),
      );
      if (kind === 'purchaseOrders')
        router.get(
          `${base}/requestOptions`,
          allowed(kind, 'read'),
          describe(
            kind,
            'RequestOptions',
            'Read minimal approved demand lines and remaining allocations',
            listResponse(executionProjection, executionMeta),
          ),
          apiValidator(
            'query',
            executionPage.extend({
              subjectId: z.string().uuid(),
              skuId: z.string().uuid().optional(),
              excludeOrderId: z.string().uuid().optional(),
              requestLineId: z.string().uuid().optional(),
            }),
          ),
          async (c) => {
            const q = c.req.valid('query'),
              conn = records.db.connection(),
              p = policies(c);
            await executionCompany(conn, q.subjectId, p);
            if (q.excludeOrderId)
              await records.head(conn, kind, q.excludeOrderId, p);
            const parents = await repo(conn, 'purchaseRequests', p).findMany({
              filter: (f) =>
                f.and([
                  f.string('subjectId').eq(q.subjectId),
                  f.string('status').eq('approved'),
                  ...(q.q
                    ? [f.string('code').includes(q.q, { mode: 'insensitive' })]
                    : []),
                ]),
              limit: 10001,
            });
            if (parents.length > 10000)
              return fail('STOCK_REFERENCE_TOO_BROAD');
            if (parents.some((row) => !row.id || !row.approvedVersionId))
              return fail('STOCK_FORBIDDEN');
            const scoped = repo(conn, 'purchaseRequestLines', p),
              filter = (f: import('@nocobase/db').FilterBuilder) =>
                f.and([
                  f.string('subjectId').eq(q.subjectId),
                  f.string('status').eq('active'),
                  f.string('identificationStatus').eq('identified'),
                  materialIdFilter(
                    f,
                    'requestId',
                    parents.map((row) => text(row.id)),
                  ),
                  ...(q.skuId ? [f.string('skuId').eq(q.skuId)] : []),
                  ...(q.requestLineId
                    ? [f.string('id').eq(q.requestLineId)]
                    : []),
                ]),
              rows = await scoped.findMany({
                filter,
                sort: (s) => [s.field('requestId').asc(), s.field('id').asc()],
                limit: q.pageSize,
                offset: (q.page - 1) * q.pageSize,
              }),
              data = [];
            for (const row of rows) {
              if (
                !row.id ||
                !row.requestId ||
                typeof row.baseQuantity !== 'string'
              )
                return fail('STOCK_FORBIDDEN');
              const allocations = await conn
                .repository('purchaseAllocations')
                .findMany({
                  filter: (f) =>
                    f.and([
                      f.string('requestLineId').eq(text(row.id)),
                      f.string('status').eq('active'),
                      ...(q.excludeOrderId
                        ? [f.string('orderId').ne(q.excludeOrderId)]
                        : []),
                    ]),
                  limit: 10001,
                });
              if (allocations.length > 10000)
                return fail('STOCK_REFERENCE_TOO_BROAD');
              const used = allocations.reduce(
                  (sum, value) => sum + stockMicros(text(value.baseQuantity)),
                  0n,
                ),
                remaining = stockMicros(row.baseQuantity) - used,
                parent = parents.find((value) => value.id === row.requestId)!;
              data.push({
                id: row.id,
                requestId: row.requestId,
                requestVersionId: parent.approvedVersionId,
                code: parent.code,
                material: row.materialSnapshot,
                baseQuantity: row.baseQuantity,
                allocatedQuantity: stockQuantity(used),
                remainingQuantity: stockQuantity(
                  remaining > 0n ? remaining : 0n,
                ),
              });
            }
            return c.json({
              data,
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
        allowed(kind, 'read'),
        describe(
          kind,
          'List',
          'List company scoped quantity orders',
          listResponse(executionProjection, executionMeta),
        ),
        apiValidator('query', executionQuery),
        async (c) =>
          c.json(await records.list(kind, c.req.valid('query'), policies(c))),
      );
      router.post(
        base,
        allowed(kind, 'create'),
        limit,
        describe(
          kind,
          'Create',
          'Create a draft quantity order and allocations in one transaction',
          dataResponse(executionProjection),
          true,
        ),
        apiValidator('json', orderCreate),
        async (c) =>
          c.json(
            {
              data: await service.save(
                kind,
                undefined,
                c.req.valid('json'),
                actor(c),
                policies(c),
              ),
            },
            201,
          ),
      );
      router.get(
        `${base}/:id/capabilities`,
        allowed(kind, 'read'),
        describe(
          kind,
          'Capabilities',
          'Read action eligibility without changing a record',
          dataResponse(executionProjection),
        ),
        apiValidator('param', executionParams),
        async (c) => {
          const decisions: Record<string, MaterialPolicies | null> = {};
          for (const action of [
            'update',
            'submit',
            'approve',
            'return',
            'withdraw',
            'revise',
            'cancel',
            'reassign',
            'copy',
            'closeRemainder',
          ]) {
            const value = await c.get('authz').authorize({
              resource: { type: 'composite', id: executionResourceIds[kind] },
              action: ['approve', 'return'].includes(action)
                ? 'review'
                : action,
            });
            decisions[action] =
              value.effect !== 'deny' && value.conditions?.database
                ? value.conditions.database
                : null;
          }
          return c.json({
            data: await service.capabilities(
              kind,
              c.req.valid('param').id,
              actor(c),
              policies(c),
              decisions,
            ),
          });
        },
      );
      router.get(
        `${base}/:id/history`,
        allowed(kind, 'read'),
        describe(
          kind,
          'History',
          'Read authorized audit history with current field scopes',
          listResponse(executionProjection, executionMeta),
        ),
        apiValidator('param', executionParams),
        apiValidator('query', executionPage),
        async (c) =>
          c.json(
            await records.history(
              kind,
              c.req.valid('param').id,
              c.req.valid('query'),
              policies(c),
            ),
          ),
      );
      router.get(
        `${base}/:id/versions`,
        allowed(kind, 'read'),
        describe(
          kind,
          'Versions',
          'Read immutable versions with current parent and line scopes',
          listResponse(executionProjection, executionMeta),
        ),
        apiValidator('param', executionParams),
        apiValidator('query', executionPage),
        async (c) =>
          c.json(
            await records.versions(
              kind,
              c.req.valid('param').id,
              c.req.valid('query'),
              policies(c),
            ),
          ),
      );
      router.get(
        `${base}/:id/versions/:versionId`,
        allowed(kind, 'read'),
        describe(
          kind,
          'Version',
          'Read a specific immutable version',
          listResponse(executionProjection, executionMeta),
        ),
        apiValidator(
          'param',
          executionParams.extend({ versionId: z.string().uuid() }),
        ),
        async (c) =>
          c.json(
            await records.versions(
              kind,
              c.req.valid('param').id,
              { page: 1, pageSize: 1 },
              policies(c),
              c.req.valid('param').versionId,
            ),
          ),
      );
      router.get(
        `${base}/:id`,
        allowed(kind, 'read'),
        describe(
          kind,
          'Detail',
          'Read one company and warehouse scoped quantity order',
          dataResponse(executionProjection),
        ),
        apiValidator('param', executionParams),
        async (c) =>
          c.json({
            data: await records.view(
              records.db.connection(),
              kind,
              c.req.valid('param').id,
              policies(c),
            ),
          }),
      );
      router.patch(
        `${base}/:id`,
        allowed(kind, 'update'),
        limit,
        describe(
          kind,
          'Update',
          'Save a draft with stable lines and both expected versions',
          dataResponse(executionProjection),
        ),
        apiValidator('param', executionParams),
        apiValidator('json', orderUpdate),
        async (c) =>
          c.json({
            data: await service.save(
              kind,
              c.req.valid('param').id,
              c.req.valid('json'),
              actor(c),
              policies(c),
            ),
          }),
      );
      router.post(
        `${base}/:id/copy`,
        allowed(kind, 'copy'),
        limit,
        describe(
          kind,
          'Copy',
          'Copy a cancelled order into a linked new draft',
          dataResponse(executionProjection),
          true,
        ),
        apiValidator('param', executionParams),
        apiValidator('json', orderUpdate),
        async (c) =>
          c.json(
            {
              data: await service.save(
                kind,
                undefined,
                c.req.valid('json'),
                actor(c),
                policies(c),
                c.req.valid('param').id,
              ),
            },
            201,
          ),
      );
      for (const action of [
        'submit',
        'approve',
        'return',
        'withdraw',
        'revise',
        'cancel',
        'reassign',
      ] as const)
        router.post(
          `${base}/:id/${action}`,
          allowed(
            kind,
            action === 'approve' || action === 'return' ? 'review' : action,
          ),
          limit,
          describe(
            kind,
            action[0].toUpperCase() + action.slice(1),
            `Apply the ${action} quantity order action`,
            dataResponse(executionProjection),
          ),
          apiValidator('param', executionParams),
          apiValidator('json', executionMutation),
          async (c) =>
            c.json({
              data: await service.fire(
                kind,
                c.req.valid('param').id,
                action,
                c.req.valid('json'),
                actor(c),
                policies(c),
              ),
            }),
        );
      router.post(
        `${base}/:id/closeRemainder`,
        allowed(kind, 'closeRemainder'),
        limit,
        describe(
          kind,
          'CloseRemainder',
          'Explicitly close unfulfilled base quantities and preserve actual facts',
          dataResponse(executionProjection),
        ),
        apiValidator('param', executionParams),
        apiValidator('json', executionQuantityAction),
        async (c) =>
          c.json({
            data: await service.fire(
              kind,
              c.req.valid('param').id,
              'closeRemainder',
              c.req.valid('json'),
              actor(c),
              policies(c),
            ),
          }),
      );
    }
    const root = new Hono();
    root.route('/', router);
    return root;
  });

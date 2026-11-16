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
  defineApiRoutes,
  describeRoute,
  listResponse,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { MaterialPolicies } from '../providers/material-service.js';
import { executionResourceIds } from '../providers/execution-resources.js';
import {
  executionMeta,
  executionParams,
  executionProjection,
} from '../providers/execution-model.js';
import { inventoryError as fail } from '../providers/inventory-quantity.js';
import { salesLedgerServiceToken } from '../providers/execution.js';
import {
  paymentCreate,
  priceListCreate,
  priceListDisable,
  priceListQuery,
  priceListUpdate,
  receivableQuery,
} from '../providers/sales-ledger-service.js';

type Env = AuthEnv &
  AuthorizationEnv & {
    Variables: { executionPolicies: MaterialPolicies };
  };

/**
 * Sales ledger endpoints: customer material prices, shipment receivables and
 * payment registration. The reads use the sales-order read grant (anyone who
 * may see orders may see the balance they produced); every write uses the
 * sales-order update grant together with the company scope carried in the
 * authorization decision.
 */
export const salesLedgerRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const router = new Hono<Env>(),
      auth = app.container.resolve(authenticationToken),
      authz = app.container.resolve(authorizationToken),
      service = app.container.resolve(salesLedgerServiceToken),
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
        maxSize: 262144,
        onError: () => {
          throw new ApiError({
            httpStatus: 413,
            status: 'INVALID_ARGUMENT',
            domain: 'sales',
            reason: 'BODY_TOO_LARGE',
            message: 'Payload too large.',
          });
        },
      }),
      allowed = (action: 'read' | 'update') =>
        createMiddleware<Env>(async (c, next) => {
          const decision = await c.get('authz').authorize({
            resource: {
              type: 'composite',
              id: executionResourceIds.salesOrders,
            },
            action,
          });
          if (decision.effect === 'deny' || !decision.conditions?.database)
            return fail('STOCK_FORBIDDEN');
          c.set('executionPolicies', decision.conditions.database);
          await next();
        }),
      describe = (
        operationId: string,
        summary: string,
        response: ReturnType<typeof dataResponse>,
        create = false,
      ) =>
        describeRoute({
          operationId,
          summary,
          tags: ['Sales ledger'],
          responses: { [create ? '201' : '200']: response, ...errors },
        }),
      meta = (page: number, pageSize: number, total: number) => ({
        page,
        pageSize,
        total,
      });

    router.onError((error, c) => apiErrorHandler(error, c));
    for (const base of ['/sales/price-lists', '/sales/receivables']) {
      router.use(base, auth.required(), authz.middleware());
      router.use(`${base}/*`, auth.required(), authz.middleware());
    }

    router.get(
      '/sales/price-lists',
      allowed('read'),
      describe(
        'salesPriceLists',
        'List customer material price lists for a company',
        listResponse(executionProjection, executionMeta),
      ),
      apiValidator('query', priceListQuery),
      async (c) => {
        const query = c.req.valid('query'),
          [data, total] = await service.priceLists(query, policies(c));
        return c.json({
          data,
          meta: meta(query.page, query.pageSize, total),
        });
      },
    );
    router.post(
      '/sales/price-lists',
      allowed('update'),
      limit,
      describe(
        'salesPriceListCreate',
        'Create a customer material price list',
        dataResponse(executionProjection),
        true,
      ),
      apiValidator('json', priceListCreate),
      async (c) =>
        c.json(
          {
            data: await service.createPriceList(
              c.req.valid('json'),
              policies(c),
              actor(c),
            ),
          },
          201,
        ),
    );
    router.patch(
      '/sales/price-lists/:id',
      allowed('update'),
      limit,
      describe(
        'salesPriceListUpdate',
        'Update a customer material price list',
        dataResponse(executionProjection),
      ),
      apiValidator('param', executionParams),
      apiValidator('json', priceListUpdate),
      async (c) =>
        c.json({
          data: await service.updatePriceList(
            c.req.valid('param').id,
            c.req.valid('json'),
            policies(c),
            actor(c),
          ),
        }),
    );
    router.post(
      '/sales/price-lists/:id/disable',
      allowed('update'),
      limit,
      describe(
        'salesPriceListDisable',
        'Disable a customer material price list',
        dataResponse(executionProjection),
      ),
      apiValidator('param', executionParams),
      apiValidator('json', priceListDisable),
      async (c) =>
        c.json({
          data: await service.disablePriceList(
            c.req.valid('param').id,
            c.req.valid('json'),
            policies(c),
            actor(c),
          ),
        }),
    );

    router.get(
      '/sales/receivables',
      allowed('read'),
      describe(
        'salesReceivables',
        'List shipment receivables with paid and outstanding balances',
        listResponse(executionProjection, executionMeta),
      ),
      apiValidator('query', receivableQuery),
      async (c) => {
        const query = c.req.valid('query'),
          [data, total] = await service.receivables(query, policies(c));
        return c.json({
          data,
          meta: meta(query.page, query.pageSize, total),
        });
      },
    );
    router.get(
      '/sales/receivables/:id',
      allowed('read'),
      describe(
        'salesReceivableDetail',
        'Read a receivable and the payments registered against it',
        dataResponse(executionProjection),
      ),
      apiValidator('param', executionParams),
      async (c) =>
        c.json({
          data: await service.receivable(c.req.valid('param').id, policies(c)),
        }),
    );
    router.post(
      '/sales/receivables/:id/payments',
      allowed('update'),
      limit,
      describe(
        'salesReceivablePaymentCreate',
        'Register a collection against a receivable',
        dataResponse(executionProjection),
        true,
      ),
      apiValidator('param', executionParams),
      apiValidator('json', paymentCreate),
      async (c) =>
        c.json(
          {
            data: await service.registerPayment(
              c.req.valid('param').id,
              c.req.valid('json'),
              policies(c),
              actor(c),
            ),
          },
          201,
        ),
    );

    const root = new Hono();
    root.route('/', router);
    return root;
  });

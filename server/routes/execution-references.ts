import { Hono } from 'hono';
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
  describeRoute,
  apiValidator,
  dataResponse,
  apiErrorResponses,
  apiErrorResponse,
  apiErrorHandler,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { executionApiError } from './execution-error.js';
import {
  executionRecordsToken,
  customerServiceToken,
} from '../providers/execution.js';
import { supplierServiceToken } from '../providers/procurement.js';
import {
  executionParams,
  executionProjection,
} from '../providers/execution-model.js';
import { executionRepo as repo } from '../providers/execution-access.js';
import { inventoryError as fail } from '../providers/inventory-quantity.js';
type Env = AuthEnv & AuthorizationEnv;
/** Single-reference reads keep selected labels truthful across paging and reloads. */
export const executionReferenceRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const router = new Hono<Env>(),
      auth = app.container.resolve(authenticationToken),
      authz = app.container.resolve(authorizationToken),
      records = app.container.resolve(executionRecordsToken);
    router.onError((error, c) => apiErrorHandler(executionApiError(error), c));
    for (const [base, resource] of [
      ['/procurement/orders', 'procurement.orders'],
      ['/sales/orders', 'sales.orders'],
      ['/warehouse/documents', 'warehouse.documents'],
      ['/warehouse/transfers', 'warehouse.transfers'],
      ['/warehouse/counts', 'warehouse.counts'],
      ['/warehouse/inventory', 'warehouse.inventory'],
      ['/warehouse/settings', 'warehouse.settings'],
    ] as const) {
      for (const kind of [
        'companies',
        'warehouses',
        'partnerOptions',
        'transferOptions',
      ] as const) {
        if (kind === 'partnerOptions' && !base.endsWith('/orders')) continue;
        if (kind === 'transferOptions' && base !== '/warehouse/inventory')
          continue;
        const path = `${base}/${kind}/:id`;
        router.use(path, auth.required(), authz.middleware());
        router.get(
          path,
          describeRoute({
            operationId: `${resource.replace('.', '')}${kind}Reference`,
            summary:
              'Read one minimal authorized reference, retaining current availability',
            tags: ['Execution references'],
            responses: {
              200: dataResponse(executionProjection),
              ...apiErrorResponses,
              '400': apiErrorResponse(400),
              '404': apiErrorResponse(404),
            },
          }),
          async (c, next) => {
            const decision = await c.get('authz').authorize({
              resource: { type: 'composite', id: resource },
              action: 'read',
            });
            if (decision.effect === 'deny' || !decision.conditions?.database)
              return fail('STOCK_FORBIDDEN');
            await next();
          },
          apiValidator('param', executionParams),
          apiValidator(
            'query',
            kind === 'companies'
              ? z.strictObject({})
              : z.strictObject({ subjectId: z.string().uuid() }),
          ),
          async (c) => {
            const decision = await c.get('authz').authorize({
                resource: { type: 'composite', id: resource },
                action: 'read',
              }),
              p = decision.conditions?.database;
            if (decision.effect === 'deny' || !p)
              return fail('STOCK_FORBIDDEN');
            const id = c.req.valid('param').id,
              q = c.req.valid('query'),
              subjectId = 'subjectId' in q ? q.subjectId : undefined;
            if (kind === 'partnerOptions') {
              if (!subjectId) return fail('STOCK_FORBIDDEN');
              const partner = app.container.resolve(
                  base.startsWith('/sales')
                    ? customerServiceToken
                    : supplierServiceToken,
                ),
                value = await partner.availabilityDetail(id, subjectId, p);
              return c.json({
                data: {
                  id: value.partnerId,
                  code: value.identity.code,
                  name: value.identity.name,
                  availability: value.effectiveStatus,
                },
              });
            }
            const conn = records.db.connection();
            if (
              subjectId &&
              !(await repo(conn, 'orgSubjects', p).exists({
                filter: { id: subjectId },
              }))
            )
              return fail('STOCK_NOT_FOUND');
            const row = await repo(
              conn,
              kind === 'companies'
                ? 'orgSubjects'
                : kind === 'transferOptions'
                  ? 'stockTransfers'
                  : 'warehouses',
              p,
            ).findOne({
              filter: {
                id,
                ...(kind !== 'companies' ? { subjectId: subjectId! } : {}),
              },
            });
            if (!row) return fail('STOCK_NOT_FOUND');
            if (
              (kind !== 'transferOptions' && typeof row.name !== 'string') ||
              typeof row.code !== 'string'
            )
              return fail('STOCK_FORBIDDEN');
            return c.json({
              data: {
                id: row.id,
                code: row.code,
                name: kind === 'transferOptions' ? row.code : row.name,
                availability: row.status,
              },
            });
          },
        );
      }
    }
    const root = new Hono();
    root.route('/', router);
    return root;
  });

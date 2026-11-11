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
import { fieldPoliciesFor, redactRows } from '../providers/field-access.js';
import type { MaterialPolicies } from '../providers/material-service.js';
import type { ExecutionKind } from '../providers/execution-workflow.js';
import {
  executionRecordsToken,
  executionReviewServiceToken,
  warehouseServiceToken,
  stockTransferServiceToken,
  stockCountServiceToken,
} from '../providers/execution.js';
import { supplyChainMaterialServiceToken } from '../providers/supply-chain.js';
import { executionResourceIds } from '../providers/execution-resources.js';
import { executionCapabilities } from '../providers/execution-capabilities.js';
import {
  warehouseSources,
  warehouseSourceKinds,
} from '../providers/warehouse-sources.js';
import {
  executionPage,
  executionQuery,
  executionParams,
  executionMeta,
  executionProjection,
  executionMutation,
  warehouseCreate,
  warehouseUpdate,
  transferCreate,
  transferUpdate,
  countCreate,
  countUpdate,
} from '../providers/execution-model.js';
import {
  materialOptionsQuery,
  materialOptionsMeta,
  materialSelectionInput,
} from '../providers/supply-chain-model.js';
import {
  executionRepo as repo,
  executionCompany,
} from '../providers/execution-access.js';
import { inventoryError as fail } from '../providers/inventory-quantity.js';

type Env = AuthEnv &
  AuthorizationEnv & { Variables: { executionPolicies: MaterialPolicies } };
type Kind = Extract<
  ExecutionKind,
  'stockDocuments' | 'stockTransfers' | 'stockCounts'
>;
export const warehouseRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const router = new Hono<Env>(),
      auth = app.container.resolve(authenticationToken),
      authz = app.container.resolve(authorizationToken),
      records = app.container.resolve(executionRecordsToken),
      reviews = app.container.resolve(executionReviewServiceToken),
      warehouse = app.container.resolve(warehouseServiceToken),
      transfers = app.container.resolve(stockTransferServiceToken),
      counts = app.container.resolve(stockCountServiceToken),
      materials = app.container.resolve(supplyChainMaterialServiceToken),
      p = (c: Context<Env>) => c.get('executionPolicies'),
      actor = (c: Context<Env>) => ({ id: c.get('auth')!.user.id }),
      errors = {
        ...apiErrorResponses,
        '400': apiErrorResponse(400),
        '404': apiErrorResponse(404),
        '409': apiErrorResponse(409),
        '413': apiErrorResponse(413),
      },
      limit = bodyLimit({
        maxSize: 8388608,
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
    router.onError((error, c) => apiErrorHandler(executionApiError(error), c));
    const allowed = (kind: Kind, action: string) =>
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
    const access = async (c: Context<Env>) => {
      const types: Record<string, MaterialPolicies | null> = {};
      for (const action of [
        'initial',
        'loss',
        'productionReceipt',
        'productionIssue',
        'quality',
        'reverse',
        'dispatch',
        'receive',
        'discrepancy',
      ]) {
        const decision = await c.get('authz').authorize({
          resource: {
            type: 'composite',
            id: ['dispatch', 'receive', 'discrepancy'].includes(action)
              ? 'warehouse.transfers'
              : 'warehouse.documents',
          },
          action,
        });
        types[action] =
          decision.effect !== 'deny' && decision.conditions?.database
            ? decision.conditions.database
            : null;
      }
      return { policies: p(c), types };
    };
    const describe = (
      kind: Kind,
      name: string,
      summary: string,
      response: ReturnType<typeof dataResponse>,
      create = false,
    ) =>
      describeRoute({
        operationId: `${kind}${name}`,
        summary,
        tags: [kind],
        responses: { [create ? '201' : '200']: response, ...errors },
      });
    const save = async (
      kind: Kind,
      id: string | undefined,
      raw: unknown,
      c: Context<Env>,
      copyFrom?: string,
    ) => {
      if (kind === 'stockDocuments')
        return warehouse.save(
          id,
          id || copyFrom
            ? warehouseUpdate.parse(raw)
            : warehouseCreate.parse(raw),
          actor(c),
          await access(c),
          copyFrom,
        );
      if (kind === 'stockTransfers')
        return transfers.save(
          id,
          id || copyFrom
            ? transferUpdate.parse(raw)
            : transferCreate.parse(raw),
          actor(c),
          p(c),
          copyFrom,
        );
      return counts.save(
        id,
        id || copyFrom ? countUpdate.parse(raw) : countCreate.parse(raw),
        actor(c),
        p(c),
        copyFrom,
      );
    };
    for (const [kind, base, createSchema, updateSchema, actions] of [
      [
        'stockDocuments',
        '/warehouse/documents',
        warehouseCreate,
        warehouseUpdate,
        [
          'submit',
          'approve',
          'return',
          'withdraw',
          'revise',
          'cancel',
          'reassign',
          'post',
        ],
      ],
      [
        'stockTransfers',
        '/warehouse/transfers',
        transferCreate,
        transferUpdate,
        [
          'submit',
          'approve',
          'return',
          'withdraw',
          'revise',
          'cancel',
          'reassign',
        ],
      ],
      [
        'stockCounts',
        '/warehouse/counts',
        countCreate,
        countUpdate,
        [
          'start',
          'submit',
          'approve',
          'return',
          'withdraw',
          'cancel',
          'reassign',
        ],
      ],
    ] as const) {
      router.use(base, auth.required(), authz.middleware());
      router.use(`${base}/*`, auth.required(), authz.middleware());
      router.get(
        `${base}/companies`,
        allowed(kind, 'read'),
        describe(
          kind,
          'Companies',
          'Search authorized active companies',
          listResponse(executionProjection, executionMeta),
        ),
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
        allowed(kind, 'read'),
        describe(
          kind,
          'Warehouses',
          'Search authorized company warehouses',
          listResponse(executionProjection, executionMeta),
        ),
        apiValidator(
          'query',
          executionPage.extend({ subjectId: z.string().uuid() }),
        ),
        async (c) => {
          const q = c.req.valid('query'),
            conn = records.db.connection();
          await executionCompany(conn, q.subjectId, p(c));
          const scoped = repo(conn, 'warehouses', p(c)),
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
        `${base}/materialOptions`,
        allowed(kind, 'read'),
        describe(
          kind,
          'MaterialOptions',
          'Search admitted stock materials',
          listResponse(executionProjection, materialOptionsMeta),
        ),
        apiValidator('query', materialOptionsQuery),
        async (c) =>
          c.json(
            await materials.options('warehouse', c.req.valid('query'), p(c)),
          ),
      );
      router.get(
        `${base}/materialOptions/:id`,
        allowed(kind, 'read'),
        describe(
          kind,
          'MaterialOption',
          'Read exact units and packaging for an admitted stock material',
          dataResponse(executionProjection),
        ),
        apiValidator('param', executionParams),
        apiValidator('query', z.strictObject({ subjectId: z.string().uuid() })),
        async (c) =>
          c.json(
            await materials.detail(
              'warehouse',
              c.req.valid('query').subjectId,
              c.req.valid('param').id,
              p(c),
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
          'Preview an exact material selection without writes',
          dataResponse(executionProjection),
        ),
        apiValidator('json', materialSelectionInput),
        async (c) =>
          c.json({
            data: await records.db.transaction((conn) =>
              materials.previewSelectionInTransaction(
                conn,
                'warehouse',
                c.req.valid('json'),
                p(c),
              ),
            ),
          }),
      );
      if (kind === 'stockDocuments')
        router.get(
          `${base}/sourceOptions`,
          allowed(kind, 'read'),
          describe(
            kind,
            'SourceOptions',
            'Read minimal approved sources without commercial or personnel payloads',
            listResponse(executionProjection, executionMeta),
          ),
          apiValidator(
            'query',
            executionPage.extend({
              kind: z.enum(warehouseSourceKinds),
              subjectId: z.string().uuid(),
              warehouseId: z.string().uuid(),
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
        base,
        allowed(kind, 'read'),
        describe(
          kind,
          'List',
          'List authorized company and warehouse records',
          listResponse(executionProjection, executionMeta),
        ),
        apiValidator('query', executionQuery),
        async (c) =>
          c.json(await records.list(kind, c.req.valid('query'), p(c))),
      );
      router.post(
        base,
        allowed(kind, 'create'),
        limit,
        describe(
          kind,
          'Create',
          'Create a validated draft and stable lines atomically',
          dataResponse(executionProjection),
          true,
        ),
        apiValidator('json', createSchema),
        async (c) =>
          c.json(
            { data: await save(kind, undefined, c.req.valid('json'), c) },
            201,
          ),
      );
      router.get(
        `${base}/:id/capabilities`,
        allowed(kind, 'read'),
        describe(
          kind,
          'Capabilities',
          'Read scoped action eligibility without writes',
          dataResponse(executionProjection),
        ),
        apiValidator('param', executionParams),
        async (c) => {
          const decisions: Record<string, MaterialPolicies | null> = {};
          for (const action of [
            'update',
            'copy',
            ...actions,
            ...(kind === 'stockTransfers'
              ? ['dispatch', 'receive', 'discrepancy']
              : []),
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
            data: await executionCapabilities(
              records,
              reviews,
              kind,
              c.req.valid('param').id,
              actor(c).id,
              p(c),
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
          'Read audit history within current field and record scopes',
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
              p(c),
            ),
          ),
      );
      router.get(
        `${base}/:id/versions`,
        allowed(kind, 'read'),
        describe(
          kind,
          'Versions',
          'Read frozen approval versions within current scopes',
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
              p(c),
            ),
          ),
      );
      router.get(
        `${base}/:id/versions/:versionId`,
        allowed(kind, 'read'),
        describe(
          kind,
          'Version',
          'Read one frozen approval version',
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
              p(c),
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
          'Read a scoped document and its authorized lines',
          dataResponse(executionProjection),
        ),
        apiValidator('param', executionParams),
        async (c) => {
          const data = await records.view(
            records.db.connection(),
            kind,
            c.req.valid('param').id,
            p(c),
          );
          const policies = await fieldPoliciesFor(records.db, {
            type: 'user',
            id: actor(c).id,
          });
          return c.json({
            data: {
              ...data,
              lines: redactRows(
                (data.lines ?? []) as Record<string, unknown>[],
                policies,
                'execution.document.line',
              ),
            },
          });
        },
      );
      router.patch(
        `${base}/:id`,
        allowed(kind, 'update'),
        limit,
        describe(
          kind,
          'Update',
          'Save against both current versions with stable line identity',
          dataResponse(executionProjection),
        ),
        apiValidator('param', executionParams),
        apiValidator('json', updateSchema),
        async (c) =>
          c.json({
            data: await save(
              kind,
              c.req.valid('param').id,
              c.req.valid('json'),
              c,
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
          'Copy a cancelled document into a new linked draft',
          dataResponse(executionProjection),
          true,
        ),
        apiValidator('param', executionParams),
        apiValidator('json', updateSchema),
        async (c) =>
          c.json(
            {
              data: await save(
                kind,
                undefined,
                c.req.valid('json'),
                c,
                c.req.valid('param').id,
              ),
            },
            201,
          ),
      );
      for (const action of actions)
        router.post(
          `${base}/:id/${action}`,
          allowed(
            kind,
            ['approve', 'return'].includes(action) ? 'review' : action,
          ),
          limit,
          describe(
            kind,
            action[0].toUpperCase() + action.slice(1),
            `Apply ${action} with fresh scope, source and version checks`,
            dataResponse(executionProjection),
          ),
          apiValidator('param', executionParams),
          apiValidator('json', executionMutation),
          async (c) => {
            const id = c.req.valid('param').id,
              input = c.req.valid('json');
            if (kind === 'stockDocuments')
              return c.json({
                data:
                  action === 'post'
                    ? await warehouse.post(id, input, actor(c), await access(c))
                    : await warehouse.fire(
                        id,
                        action as
                          | 'submit'
                          | 'approve'
                          | 'return'
                          | 'withdraw'
                          | 'revise'
                          | 'cancel'
                          | 'reassign',
                        input,
                        actor(c),
                        await access(c),
                      ),
              });
            if (kind === 'stockTransfers')
              return c.json({
                data: await transfers.fire(
                  id,
                  action as
                    | 'submit'
                    | 'approve'
                    | 'return'
                    | 'withdraw'
                    | 'revise'
                    | 'cancel'
                    | 'reassign',
                  input,
                  actor(c),
                  p(c),
                ),
              });
            return c.json({
              data: await counts.fire(
                id,
                action as
                  | 'start'
                  | 'submit'
                  | 'approve'
                  | 'return'
                  | 'withdraw'
                  | 'cancel'
                  | 'reassign',
                input,
                actor(c),
                p(c),
              ),
            });
          },
        );
    }
    const root = new Hono();
    root.route('/', router);
    return root;
  });

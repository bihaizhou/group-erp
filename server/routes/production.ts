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
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { databaseManagerToken } from '@nocobase/db';
import { createHash, randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { accessFor, fieldPoliciesFor } from '../providers/field-access.js';
import { resourceFieldNames } from '../providers/field-catalog.js';
import { warehouseCreate } from '../providers/execution-model.js';
import { warehouseServiceToken } from '../providers/execution.js';
import type { WarehouseAccess } from '../providers/warehouse-service.js';
import {
  attendanceQuery,
  attendanceSave,
  downtimeCancel,
  downtimeClose,
  downtimeInput,
  downtimeParams,
  downtimeQuery,
  equipmentInput,
  equipmentParams,
  equipmentQuery,
  equipmentUpdate,
  maintenanceInput,
  maintenanceParams,
  maintenancePlanInput,
  maintenancePlanParams,
  maintenancePlanQuery,
  maintenancePlanUpdate,
  maintenanceQuery,
  maintenanceUpdate,
  overtimeCandidatesQuery,
  overtimeDecision,
  overtimeInput,
  overtimeParams,
  overtimeQuery,
  productionReportQuery,
  productionReportSave,
  productionScheduleId,
  productionScheduleParams,
  productionScheduleSave,
  shiftReportInput,
  shiftReportInputCreate,
  shiftReportInputDelete,
  shiftReportInputParams,
  shiftReportInputUpdate,
  shiftReportMutation,
  shiftReportParams,
  shiftReportQuery,
  shiftReportUpdate,
  shiftReportVoid,
  unitSetupInput,
  unitSetupParams,
} from '../providers/production-model.js';
import {
  ProductionError,
  type ProductionScope,
  productionServiceToken,
} from '../providers/production-service.js';

type Env = AuthEnv & AuthorizationEnv;
const errors = {
  ...apiErrorResponses,
  '400': apiErrorResponse(400),
  '403': apiErrorResponse(403),
  '404': apiErrorResponse(404),
  '409': apiErrorResponse(409),
};
const object = z.record(z.string(), z.unknown());

function productionInboundRequestKey(reportId: string, version: number) {
  // Stable across retries, but distinct after a report is voided/reopened and
  // confirmed again, so a cancelled receipt is never reused.
  const hash = createHash('sha256')
    .update(`production-inbound:${reportId}:${version}`)
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function toApiError(error: ProductionError) {
  const status =
    error.code === 'PRODUCTION_FORBIDDEN'
      ? 'PERMISSION_DENIED'
      : error.code === 'PRODUCTION_NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'PRODUCTION_CONFLICT'
          ? 'ABORTED'
          : 'INVALID_ARGUMENT';
  return new ApiError({
    status,
    domain: 'production',
    reason: error.code,
    message: error.message,
  });
}

const materialResource = 'production.report.material';

export const productionRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const service = app.container.resolve(productionServiceToken);
    const database = app.container.resolve(databaseManagerToken);
    const warehouse = app.container.resolve(warehouseServiceToken);
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const router = new Hono<Env>();
    for (const path of [
      '/options',
      '/companies',
      '/report-context',
      '/report',
      '/attendance',
      '/setup',
      '/setup/:unitId',
      '/schedules',
      '/schedules/:id/publish',
      '/equipment',
      '/equipment/:id',
      '/maintenance-orders',
      '/maintenance-orders/:id',
      '/maintenance-plans',
      '/maintenance-plans/:id',
      '/maintenance-plans/:id/generate',
      '/overtime',
      '/overtime/candidates',
      '/overtime/:id/decision',
      '/downtime-events',
      '/downtime-events/:id/close',
      '/downtime-events/:id/cancel',
      '/shift-reports',
      '/shift-reports/:id',
      '/shift-reports/:id/confirm',
      '/shift-reports/:id/void',
      '/shift-reports/:id/reopen',
      '/shift-reports/:id/inbound',
      '/shift-reports/:id/input-options',
      '/shift-reports/:id/inputs',
      '/shift-reports/:id/inputs/:inputId',
    ])
      router.use(path, auth.required(), authz.middleware());
    const actor = (c: Context<Env>) => ({
      type: 'user',
      id: c.get('auth')!.user.id,
    });
    const scoped = async (c: Context<Env>): Promise<ProductionScope> => {
      const context = c.get('authz');
      const result = async (action: string) =>
        (
          await context.authorize({
            resource: { type: 'settings', id: 'production' },
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
          resource: { type: 'settings', id: 'production' },
          action,
        });
        if (result.effect === 'deny')
          throw new ProductionError(
            'PRODUCTION_FORBIDDEN',
            'PERMISSION_DENIED',
          );
        await next();
      });
    const describe = (
      operationId: string,
      summary: string,
      response: ReturnType<typeof dataResponse>,
    ) =>
      describeRoute({
        operationId,
        summary,
        tags: ['Production'],
        responses: { '200': response, ...errors },
      });
    router.onError((error, c) => {
      if (error instanceof ProductionError)
        return apiErrorHandler(toApiError(error), c);
      return apiErrorHandler(error, c);
    });

    router.get(
      '/options',
      allowed('read'),
      describe(
        'productionOptions',
        'Read production units and companies',
        dataResponse(object),
      ),
      async (c) =>
        c.json({ data: await service.options(actor(c), await scoped(c)) }),
    );

    router.get(
      '/report-context',
      allowed('read'),
      describe(
        'productionReportContext',
        'Read the reporting identity and the shift in progress',
        dataResponse(object),
      ),
      async (c) =>
        c.json({
          data: await service.reportContext(actor(c), await scoped(c)),
        }),
    );

    router.get(
      '/report',
      allowed('read'),
      describe(
        'productionReport',
        'Read one unit shift with attendance, downtime and overtime',
        dataResponse(object),
      ),
      apiValidator('query', productionReportQuery),
      async (c) => {
        const data = await service.getReport(
          actor(c),
          c.req.valid('query'),
          await scoped(c),
        );
        const policies = await fieldPoliciesFor(database, actor(c));
        const hiddenFields = new Set(
          (await resourceFieldNames(database, materialResource)).filter(
            (field) =>
              accessFor(policies, materialResource, field) === 'hidden',
          ),
        );
        for (const line of data.report?.materials ?? []) {
          for (const field of hiddenFields) {
            const row = line as unknown as Record<string, unknown>;
            if (!(field in row)) continue;
            row[field] = field === 'quantity' ? '0' : null;
          }
        }
        return c.json({ data });
      },
    );

    router.put(
      '/report',
      allowed('manage'),
      describe(
        'productionReportSave',
        'Submit a unit shift with its report, attendance, downtime and overtime',
        dataResponse(object),
      ),
      apiValidator('json', productionReportSave),
      async (c) => {
        const input = c.req.valid('json');
        const policies = await fieldPoliciesFor(database, actor(c));
        const quantityWritable =
          accessFor(policies, materialResource, 'quantity') === 'write';
        const stockWritable =
          accessFor(policies, materialResource, 'stockQuantity') === 'write';
        for (const line of input.report?.materials ?? []) {
          if (!quantityWritable && line.quantity !== undefined) {
            throw new ApiError({
              status: 'PERMISSION_DENIED',
              domain: 'production',
              reason: 'FIELD_NOT_WRITABLE',
              message: 'quantity is not writable for this account',
            });
          }
          if (!stockWritable && line.stockQuantity !== undefined) {
            throw new ApiError({
              status: 'PERMISSION_DENIED',
              domain: 'production',
              reason: 'FIELD_NOT_WRITABLE',
              message: 'stockQuantity is not writable for this account',
            });
          }
        }
        return c.json({
          data: await service.submitReport(actor(c), input, await scoped(c)),
        });
      },
    );

    router.get(
      '/companies',
      allowed('read'),
      describe(
        'productionCompanies',
        'List companies available to production',
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
      '/attendance',
      allowed('read'),
      describe(
        'productionAttendance',
        'Read attendance roster for a production unit and shift',
        dataResponse(object),
      ),
      apiValidator('query', attendanceQuery),
      async (c) =>
        c.json({
          data: await service.roster(
            actor(c),
            c.req.valid('query'),
            await scoped(c),
          ),
        }),
    );

    router.get(
      '/setup',
      allowed('read'),
      describe(
        'productionSetup',
        'Read production unit profiles and output mappings',
        dataResponse(object),
      ),
      async (c) =>
        c.json({ data: await service.setup(actor(c), await scoped(c)) }),
    );

    router.put(
      '/setup/:unitId',
      allowed('manage'),
      describe(
        'productionSetupSave',
        'Save a production unit profile and output SKU mappings',
        dataResponse(object),
      ),
      apiValidator('param', unitSetupParams),
      apiValidator('json', unitSetupInput),
      async (c) =>
        c.json({
          data: await service.saveUnitSetup(
            actor(c),
            c.req.valid('param').unitId,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.put(
      '/attendance',
      allowed('manage'),
      describe(
        'productionAttendanceSave',
        'Save attendance and overtime for a production unit and shift',
        dataResponse(object),
      ),
      apiValidator('json', attendanceSave),
      async (c) =>
        c.json({
          data: await service.save(
            actor(c),
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.get(
      '/schedules',
      allowed('read'),
      describe(
        'productionSchedule',
        'Read a production shift schedule and its candidates',
        dataResponse(object),
      ),
      apiValidator('query', productionScheduleParams),
      async (c) =>
        c.json({
          data: await service.getSchedule(
            actor(c),
            c.req.valid('query'),
            await scoped(c),
          ),
        }),
    );

    router.put(
      '/schedules',
      allowed('manage'),
      describe(
        'productionScheduleSave',
        'Save a draft production shift schedule',
        dataResponse(object),
      ),
      apiValidator('json', productionScheduleSave),
      async (c) =>
        c.json({
          data: await service.saveSchedule(
            actor(c),
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/schedules/:id/publish',
      allowed('manage'),
      describe(
        'productionSchedulePublish',
        'Publish a production shift schedule',
        dataResponse(object),
      ),
      apiValidator('param', productionScheduleId),
      async (c) =>
        c.json({
          data: await service.publishSchedule(
            actor(c),
            c.req.valid('param').id,
            await scoped(c),
          ),
        }),
    );

    router.get(
      '/downtime-events',
      allowed('read'),
      describe(
        'productionDowntimeEvents',
        'List production downtime events',
        dataResponse(object),
      ),
      apiValidator('query', downtimeQuery),
      async (c) =>
        c.json({
          data: await service.listDowntimeEvents(
            actor(c),
            c.req.valid('query'),
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/downtime-events',
      allowed('manage'),
      describe(
        'productionCreateDowntimeEvent',
        'Report a production downtime event',
        dataResponse(object),
      ),
      apiValidator('json', downtimeInput),
      async (c) =>
        c.json(
          {
            data: await service.createDowntimeEvent(
              actor(c),
              c.req.valid('json'),
              await scoped(c),
            ),
          },
          201,
        ),
    );

    router.post(
      '/downtime-events/:id/close',
      allowed('manage'),
      describe(
        'productionCloseDowntimeEvent',
        'Close a production downtime event',
        dataResponse(object),
      ),
      apiValidator('param', downtimeParams),
      apiValidator('json', downtimeClose),
      async (c) =>
        c.json({
          data: await service.closeDowntimeEvent(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/downtime-events/:id/cancel',
      allowed('manage'),
      describe(
        'productionCancelDowntimeEvent',
        'Cancel a production downtime event',
        dataResponse(object),
      ),
      apiValidator('param', downtimeParams),
      apiValidator('json', downtimeCancel),
      async (c) =>
        c.json({
          data: await service.cancelDowntimeEvent(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.get(
      '/shift-reports',
      allowed('read'),
      describe(
        'productionShiftReports',
        'List production shift reports for a unit',
        dataResponse(object),
      ),
      apiValidator('query', shiftReportQuery),
      async (c) =>
        c.json({
          data: await service.listShiftReports(
            actor(c),
            c.req.valid('query'),
            await scoped(c),
          ),
        }),
    );

    router.get(
      '/shift-reports/:id',
      allowed('read'),
      describe(
        'productionShiftReport',
        'Read a production shift report with output snapshots',
        dataResponse(object),
      ),
      apiValidator('param', shiftReportParams),
      async (c) =>
        c.json({
          data: await service.getShiftReport(
            actor(c),
            c.req.valid('param').id,
            await scoped(c),
          ),
        }),
    );

    router.get(
      '/shift-reports/:id/input-options',
      allowed('read'),
      describe(
        'productionShiftReportInputOptions',
        'List materials and posted issue documents available as shift report inputs',
        dataResponse(object),
      ),
      apiValidator('param', shiftReportParams),
      async (c) =>
        c.json({
          data: await service.shiftReportInputOptions(
            actor(c),
            c.req.valid('param').id,
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/shift-reports/:id/inputs',
      allowed('manage'),
      describe(
        'productionShiftReportInputCreate',
        'Add a manual or issue-linked material input to a draft shift report',
        dataResponse(object),
      ),
      apiValidator('param', shiftReportParams),
      apiValidator('json', shiftReportInputCreate),
      async (c) =>
        c.json({
          data: await service.addShiftReportInput(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.patch(
      '/shift-reports/:id/inputs/:inputId',
      allowed('manage'),
      describe(
        'productionShiftReportInputUpdate',
        'Correct a manual material input on a draft shift report',
        dataResponse(object),
      ),
      apiValidator('param', shiftReportInputParams),
      apiValidator('json', shiftReportInputUpdate),
      async (c) =>
        c.json({
          data: await service.updateShiftReportInput(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('param').inputId,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.delete(
      '/shift-reports/:id/inputs/:inputId',
      allowed('manage'),
      describe(
        'productionShiftReportInputDelete',
        'Remove an unlinked input from a draft shift report',
        dataResponse(object),
      ),
      apiValidator('param', shiftReportInputParams),
      apiValidator('json', shiftReportInputDelete),
      async (c) =>
        c.json({
          data: await service.removeShiftReportInput(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('param').inputId,
            c.req.valid('json').version,
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/shift-reports',
      allowed('manage'),
      describe(
        'productionShiftReportCreate',
        'Create a draft production shift report',
        dataResponse(object),
      ),
      apiValidator('json', shiftReportInput),
      async (c) =>
        c.json({
          data: await service.createShiftReport(
            actor(c),
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.put(
      '/shift-reports/:id',
      allowed('manage'),
      describe(
        'productionShiftReportUpdate',
        'Update a draft production shift report',
        dataResponse(object),
      ),
      apiValidator('param', shiftReportParams),
      apiValidator('json', shiftReportUpdate),
      async (c) =>
        c.json({
          data: await service.updateShiftReport(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/shift-reports/:id/confirm',
      allowed('manage'),
      describe(
        'productionShiftReportConfirm',
        'Confirm a shift report and snapshot its material outputs',
        dataResponse(object),
      ),
      apiValidator('param', shiftReportParams),
      apiValidator('json', shiftReportMutation),
      async (c) =>
        c.json({
          data: await service.confirmShiftReport(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json').version,
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/shift-reports/:id/void',
      allowed('manage'),
      describe(
        'productionShiftReportVoid',
        'Void a confirmed shift report before its inbound receipt is posted',
        dataResponse(object),
      ),
      apiValidator('param', shiftReportParams),
      apiValidator('json', shiftReportVoid),
      async (c) =>
        c.json({
          data: await service.voidShiftReport(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/shift-reports/:id/reopen',
      allowed('manage'),
      describe(
        'productionShiftReportReopen',
        'Reopen a voided shift report as a draft for correction',
        dataResponse(object),
      ),
      apiValidator('param', shiftReportParams),
      apiValidator('json', shiftReportMutation),
      async (c) =>
        c.json({
          data: await service.reopenShiftReport(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json').version,
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/shift-reports/:id/inbound',
      allowed('manage'),
      describe(
        'productionShiftReportInbound',
        'Create a warehouse production-receipt draft from a confirmed shift report',
        dataResponse(object),
      ),
      apiValidator('param', shiftReportParams),
      async (c) => {
        const [create, receipt] = await Promise.all([
          c.get('authz').authorize({
            resource: { type: 'composite', id: 'warehouse.documents' },
            action: 'create',
          }),
          c.get('authz').authorize({
            resource: { type: 'composite', id: 'warehouse.documents' },
            action: 'productionReceipt',
          }),
        ]);
        if (
          create.effect === 'deny' ||
          receipt.effect === 'deny' ||
          !create.conditions?.database ||
          !receipt.conditions?.database
        )
          throw new ProductionError(
            'PRODUCTION_FORBIDDEN',
            'WAREHOUSE_PERMISSION_REQUIRED',
          );
        const scope = await scoped(c);
        const draft = await service.inboundDraft(
          actor(c),
          c.req.valid('param').id,
          scope,
        );
        if (draft.documentId)
          return c.json({
            data: await service.getShiftReport(
              actor(c),
              draft.report.id,
              scope,
            ),
          });
        const access: WarehouseAccess = {
          policies: create.conditions.database,
          types: { productionReceipt: receipt.conditions.database },
        };
        const subjectId = draft.report.subjectId;
        const document = await warehouse.save(
          undefined,
          warehouseCreate.parse({
            requestKey: productionInboundRequestKey(
              draft.report.id,
              draft.report.version,
            ),
            content: {
              kind: 'productionReceipt',
              subjectId,
              warehouseId: draft.lines[0].warehouseId,
              occurredOn: draft.report.reportDate,
              reason: `生产班报 ${draft.report.id}`,
              notes: '',
              productionEvidence: {
                reference: draft.report.id,
                title: `${draft.report.unitName} ${draft.report.reportDate} ${draft.report.shift}`,
                description: '由生产班报确认后自动生成，待仓库核对过账。',
                occurredOn: draft.report.reportDate,
                shiftReportId: draft.report.id,
              },
              lines: draft.lines.map((line) => ({
                id: randomUUID(),
                selection: {
                  kind: 'known' as const,
                  subjectId,
                  skuId: line.skuId,
                  quantity: line.quantity,
                  unitId: line.unitId,
                },
                quality: 'qualified' as const,
                notes: '',
              })),
            },
          }),
          actor(c),
          access,
        );
        const documentId = typeof document.id === 'string' ? document.id : '';
        if (!documentId)
          throw new ProductionError(
            'PRODUCTION_CONFLICT',
            'INBOUND_DOCUMENT_MISSING',
          );
        await service.linkInbound(actor(c), draft.report.id, documentId, scope);
        return c.json({
          data: await service.getShiftReport(actor(c), draft.report.id, scope),
        });
      },
    );

    router.get(
      '/equipment',
      allowed('read'),
      describe(
        'productionEquipment',
        'List production equipment for a company or unit',
        dataResponse(object),
      ),
      apiValidator('query', equipmentQuery),
      async (c) =>
        c.json({
          data: await service.listEquipment(
            actor(c),
            c.req.valid('query'),
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/equipment',
      allowed('manage'),
      describe(
        'productionEquipmentCreate',
        'Create a production equipment record',
        dataResponse(object),
      ),
      apiValidator('json', equipmentInput),
      async (c) =>
        c.json({
          data: await service.createEquipment(
            actor(c),
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.patch(
      '/equipment/:id',
      allowed('manage'),
      describe(
        'productionEquipmentUpdate',
        'Update a production equipment record',
        dataResponse(object),
      ),
      apiValidator('param', equipmentParams),
      apiValidator('json', equipmentUpdate),
      async (c) =>
        c.json({
          data: await service.updateEquipment(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.get(
      '/maintenance-plans',
      allowed('read'),
      describe(
        'productionMaintenancePlans',
        'List preventive maintenance and inspection plans',
        dataResponse(object),
      ),
      apiValidator('query', maintenancePlanQuery),
      async (c) =>
        c.json({
          data: await service.listMaintenancePlans(
            actor(c),
            c.req.valid('query'),
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/maintenance-plans',
      allowed('manage'),
      describe(
        'productionMaintenancePlanCreate',
        'Create a preventive maintenance or inspection plan',
        dataResponse(object),
      ),
      apiValidator('json', maintenancePlanInput),
      async (c) =>
        c.json({
          data: await service.createMaintenancePlan(
            actor(c),
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.patch(
      '/maintenance-plans/:id',
      allowed('manage'),
      describe(
        'productionMaintenancePlanUpdate',
        'Update a maintenance plan or pause it',
        dataResponse(object),
      ),
      apiValidator('param', maintenancePlanParams),
      apiValidator('json', maintenancePlanUpdate),
      async (c) =>
        c.json({
          data: await service.updateMaintenancePlan(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/maintenance-plans/:id/generate',
      allowed('manage'),
      describe(
        'productionMaintenancePlanGenerate',
        'Create an open maintenance order from a due plan',
        dataResponse(object),
      ),
      apiValidator('param', maintenancePlanParams),
      async (c) =>
        c.json({
          data: await service.generatePlanOrder(
            actor(c),
            c.req.valid('param').id,
            await scoped(c),
          ),
        }),
    );

    router.get(
      '/maintenance-orders',
      allowed('read'),
      describe(
        'productionMaintenanceOrders',
        'List repair and maintenance orders',
        dataResponse(object),
      ),
      apiValidator('query', maintenanceQuery),
      async (c) =>
        c.json({
          data: await service.listMaintenanceOrders(
            actor(c),
            c.req.valid('query'),
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/maintenance-orders',
      allowed('manage'),
      describe(
        'productionMaintenanceOrderCreate',
        'Report a repair or maintenance order',
        dataResponse(object),
      ),
      apiValidator('json', maintenanceInput),
      async (c) =>
        c.json({
          data: await service.createMaintenanceOrder(
            actor(c),
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.patch(
      '/maintenance-orders/:id',
      allowed('manage'),
      describe(
        'productionMaintenanceOrderUpdate',
        'Update maintenance status and completion details',
        dataResponse(object),
      ),
      apiValidator('param', maintenanceParams),
      apiValidator('json', maintenanceUpdate),
      async (c) =>
        c.json({
          data: await service.updateMaintenanceOrder(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.get(
      '/overtime',
      allowed('read'),
      describe(
        'productionOvertime',
        'List production overtime requests',
        dataResponse(object),
      ),
      apiValidator('query', overtimeQuery),
      async (c) =>
        c.json({
          data: await service.listOvertime(
            actor(c),
            c.req.valid('query'),
            await scoped(c),
          ),
        }),
    );

    router.get(
      '/overtime/candidates',
      allowed('read'),
      describe(
        'productionOvertimeCandidates',
        'List production people available for overtime on a date',
        dataResponse(object),
      ),
      apiValidator('query', overtimeCandidatesQuery),
      async (c) =>
        c.json({
          data: await service.overtimeCandidates(
            actor(c),
            c.req.valid('query'),
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/overtime',
      allowed('manage'),
      describe(
        'productionOvertimeCreate',
        'Submit a production overtime request',
        dataResponse(object),
      ),
      apiValidator('json', overtimeInput),
      async (c) =>
        c.json({
          data: await service.createOvertime(
            actor(c),
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    router.post(
      '/overtime/:id/decision',
      allowed('approve'),
      describe(
        'productionOvertimeDecision',
        'Approve or reject a production overtime request',
        dataResponse(object),
      ),
      apiValidator('param', overtimeParams),
      apiValidator('json', overtimeDecision),
      async (c) =>
        c.json({
          data: await service.decideOvertime(
            actor(c),
            c.req.valid('param').id,
            c.req.valid('json'),
            await scoped(c),
          ),
        }),
    );

    const root = new Hono();
    root.route('/production', router);
    return root;
  });

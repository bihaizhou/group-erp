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
import {
  LifecycleError,
  ParameterConfigurationError,
  lifecycleErrorFields,
} from '@nocobase/lifecycle';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { supplyChainMaterialServiceToken } from '../providers/supply-chain.js';
import { supplierServiceToken } from '../providers/procurement.js';
import {
  materialOptionsQuery,
  materialOptionsMeta,
  materialSelectionInput,
  materialSelectionOutput,
} from '../providers/supply-chain-model.js';
import { supplierAvailabilityQuery } from '../providers/partner-applicability.js';
import { MaterialError } from '../providers/material-model.js';
import { materialApiError } from './material-error.js';
import { createMiddleware } from 'hono/factory';
import { bodyLimit } from 'hono/body-limit';
import { SupplyChainError } from '../providers/supply-chain-model.js';
import { purchaseRequestServiceToken } from '../providers/procurement.js';
import {
  purchaseError,
  type PurchaseAccess,
} from '../providers/purchase-request-service.js';
import type { PurchasePermissionAction } from '../providers/purchase-request-resources.js';
import {
  purchaseCreate,
  purchaseUpdate,
  purchaseAction,
  purchaseParams,
  purchaseQuery,
  purchaseMergeQuery,
  purchasePage,
  purchaseMeta,
  purchaseView,
  purchaseListView,
  purchaseAuditView,
  purchaseOptionQuery,
  purchaseOptionView,
  purchaseSettingsQuery,
  purchaseSettingsSave,
  purchaseSettingsView,
  purchaseCapabilityView,
  purchaseCompanyMeta,
  purchaseIdentityView,
  purchaseMergeView,
} from '../providers/purchase-request-model.js';

type Env = AuthEnv &
  AuthorizationEnv & { Variables: { purchaseAccess: PurchaseAccess } };
const errors = {
  ...apiErrorResponses,
  '400': apiErrorResponse(400),
  '404': apiErrorResponse(404),
  '409': apiErrorResponse(409),
  '413': apiErrorResponse(413),
};
export const procurementRequestRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const service = app.container.resolve(purchaseRequestServiceToken),
      auth = app.container.resolve(authenticationToken),
      authz = app.container.resolve(authorizationToken);
    const router = new Hono<Env>();
    for (const path of [
      '/requests',
      '/requests/*',
      '/requestIdentity',
      '/merge',
      '/requestOptions',
      '/requestCompanies',
      '/requestMaterialOptions',
      '/requestMaterialOptions/*',
      '/requestMaterialSelections',
      '/requestSupplierOptions',
      '/settings/companies',
      '/settings',
      '/settings/options',
    ])
      router.use(path, auth.required(), authz.middleware());
    const actor = (c: Context<Env>) => ({ id: c.get('auth')!.user.id });
    const access = (c: Context<Env>) => c.get('purchaseAccess');
    const allowed = (
      action: PurchasePermissionAction | 'update',
      settings = false,
    ) =>
      createMiddleware<Env>(async (c, next) => {
        const context = c.get('authz');
        const result = await context.authorize({
          resource: {
            type: 'composite',
            id: settings ? 'procurement.settings' : 'procurement.requests',
          },
          action,
        });
        if (result.effect === 'deny' || !result.conditions?.database)
          return purchaseError('PURCHASE_FORBIDDEN', 'PERMISSION_DENIED');
        const source =
          !settings && action === 'submit'
            ? await context.authorize({
                resource: { type: 'composite', id: 'procurement.requests' },
                action: 'requestGovernance',
              })
            : null;
        c.set('purchaseAccess', {
          policies: result.conditions.database,
          source:
            source && source.effect !== 'deny' && source.conditions?.database
              ? {
                  policies: source.conditions.database,
                  delegate: null,
                }
              : undefined,
        });
        await next();
      });
    const limit = bodyLimit({
      maxSize: 1048576,
      onError: () => {
        throw new ApiError({
          status: 'INVALID_ARGUMENT',
          httpStatus: 413,
          domain: 'procurement',
          reason: 'BODY_TOO_LARGE',
          message: 'Payload too large.',
        });
      },
    });
    const describe = (
      operationId: string,
      summary: string,
      response: ReturnType<typeof dataResponse>,
      create = false,
    ) =>
      describeRoute({
        operationId,
        summary,
        tags: ['Purchase requests'],
        responses: { [create ? '201' : '200']: response, ...errors },
      });
    router.onError((error, c) => {
      if (error instanceof MaterialError)
        return apiErrorHandler(materialApiError(error), c);
      if (error instanceof ParameterConfigurationError) {
        const conflict = [
          'CONFIGURATION_CONFLICT',
          'CONFIGURATION_REQUEST_REUSED',
        ].includes(error.code);
        return apiErrorHandler(
          new ApiError({
            status: conflict ? 'ABORTED' : 'FAILED_PRECONDITION',
            domain: 'procurement',
            reason: error.code,
            message: 'The purchase rule configuration could not be applied.',
          }),
          c,
        );
      }
      if (error instanceof SupplyChainError)
        return apiErrorHandler(
          new ApiError({
            status:
              error.reason === 'SUPPLY_FORBIDDEN'
                ? 'PERMISSION_DENIED'
                : 'INVALID_ARGUMENT',
            domain: 'procurement',
            reason: error.reason,
            message: 'The material selection could not be applied.',
            ...(error.field
              ? {
                  fieldViolations: [
                    { field: error.field, description: error.reason },
                  ],
                }
              : {}),
          }),
          c,
        );
      const fields =
        error instanceof LifecycleError
          ? lifecycleErrorFields(error)
          : undefined;
      return apiErrorHandler(
        fields ? new ApiError({ ...fields, domain: 'procurement' }) : error,
        c,
      );
    });
    router.get(
      '/requests/:id/capabilities',
      allowed('read'),
      describe(
        'purchaseRequestCapabilities',
        'Read current action eligibility without recording a transition or parameter snapshot',
        dataResponse(purchaseCapabilityView),
      ),
      apiValidator('param', purchaseParams),
      async (c) => {
        const context = c.get('authz');
        const decisions: Record<string, PurchaseAccess | null> = {};
        const sourceDecision = await context.authorize({
          resource: { type: 'composite', id: 'procurement.requests' },
          action: 'requestGovernance',
        });
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
          'requestGovernance',
          'confirmMaterial',
          'rejectMaterial',
          'takeOverSource',
        ] as const) {
          const result = await context.authorize({
            resource: { type: 'composite', id: 'procurement.requests' },
            action:
              action === 'copy'
                ? 'create'
                : action === 'approve' || action === 'return'
                  ? 'review'
                  : action,
          });
          decisions[action] =
            result.effect !== 'deny' && result.conditions?.database
              ? {
                  policies: result.conditions.database,
                  source:
                    sourceDecision.effect !== 'deny' &&
                    sourceDecision.conditions?.database
                      ? {
                          policies: sourceDecision.conditions.database,
                          delegate: null,
                        }
                      : undefined,
                }
              : null;
        }
        return c.json({
          data: await service.capabilities(
            c.req.valid('param').id,
            actor(c),
            access(c),
            decisions,
          ),
        });
      },
    );
    const materialService = app.container.resolve(
      supplyChainMaterialServiceToken,
    );
    const supplierService = app.container.resolve(supplierServiceToken);
    const projection = z.record(z.string(), z.json());
    router.get(
      '/requestMaterialOptions',
      allowed('read'),
      describe(
        'purchaseRequestMaterialOptions',
        'Search company eligible materials under purchase request permissions',
        listResponse(projection, materialOptionsMeta),
      ),
      apiValidator('query', materialOptionsQuery),
      async (c) =>
        c.json(
          await materialService.options(
            'procurement',
            c.req.valid('query'),
            access(c).policies,
          ),
        ),
    );
    router.get(
      '/requestMaterialOptions/:id',
      allowed('read'),
      describe(
        'purchaseRequestMaterialOption',
        'Read a company eligible material and its exact unit rules',
        dataResponse(projection),
      ),
      apiValidator('param', purchaseParams),
      apiValidator('query', purchaseSettingsQuery),
      async (c) =>
        c.json(
          await service.materialOption(
            c.req.valid('query').subjectId,
            c.req.valid('param').id,
            access(c).policies,
          ),
        ),
    );
    router.post(
      '/requestMaterialSelections',
      allowed('read'),
      limit,
      describe(
        'purchaseRequestMaterialSelection',
        'Preview demand quantity without creating a request or governance task',
        dataResponse(materialSelectionOutput),
      ),
      apiValidator('json', materialSelectionInput),
      async (c) =>
        c.json({
          data: await materialService.resolveSelection(
            'procurement',
            c.req.valid('json'),
            access(c).policies,
          ),
        }),
    );
    router.get(
      '/requestSupplierOptions',
      allowed('read'),
      describe(
        'purchaseRequestSupplierOptions',
        'Read minimal company eligible supplier options without supplier maintenance access',
        listResponse(purchaseOptionView, purchaseMeta),
      ),
      apiValidator('query', supplierAvailabilityQuery),
      async (c) => {
        const result = await supplierService.availability(
          c.req.valid('query'),
          access(c).policies,
          true,
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
      '/requests',
      allowed('read'),
      describe(
        'purchaseRequests',
        'List purchase requests in an authorized company',
        listResponse(purchaseListView, purchaseMeta),
      ),
      apiValidator('query', purchaseQuery),
      async (c) =>
        c.json(
          await service.list(
            c.req.valid('query'),
            actor(c),
            access(c).policies,
          ),
        ),
    );
    router.get(
      '/requestIdentity',
      allowed('read'),
      describe(
        'purchaseRequestIdentity',
        'Read the caller’s effective employment companies and departments',
        dataResponse(purchaseIdentityView),
      ),
      async (c) =>
        c.json({
          data: await service.identity(actor(c)),
        }),
    );
    router.get(
      '/merge',
      allowed('merge'),
      describe(
        'purchaseRequestMerge',
        'Read the group purchase list derived from approved request lines',
        listResponse(purchaseMergeView, purchaseMeta),
      ),
      apiValidator('query', purchaseMergeQuery),
      async (c) => {
        const identity = await service.identity(actor(c));
        if (!identity.companies.some((company) => company.units.length > 0))
          return purchaseError(
            'PURCHASE_POSITION_REQUIRED',
            'PERMISSION_DENIED',
          );
        return c.json(
          await service.merge(c.req.valid('query'), access(c).policies),
        );
      },
    );
    router.post(
      '/requests',
      allowed('create'),
      limit,
      describe(
        'createPurchaseRequest',
        'Create a draft purchase request and stable lines atomically',
        dataResponse(purchaseView),
        true,
      ),
      apiValidator('json', purchaseCreate),
      async (c) =>
        c.json(
          {
            data: await service.create(
              c.req.valid('json'),
              actor(c),
              access(c),
            ),
          },
          201,
        ),
    );
    router.get(
      '/requests/:id',
      allowed('read'),
      describe(
        'purchaseRequestDetail',
        'Read a purchase request, lines and immutable review history',
        dataResponse(purchaseView),
      ),
      apiValidator('param', purchaseParams),
      async (c) =>
        c.json({
          data: await service.detail(
            c.req.valid('param').id,
            access(c).policies,
          ),
        }),
    );
    router.get(
      '/requests/:id/history',
      allowed('read'),
      describe(
        'purchaseRequestHistory',
        'Read scoped purchase request audit history',
        listResponse(purchaseAuditView, purchaseMeta),
      ),
      apiValidator('param', purchaseParams),
      apiValidator('query', purchasePage),
      async (c) =>
        c.json(
          await service.history(
            c.req.valid('param').id,
            c.req.valid('query'),
            access(c).policies,
          ),
        ),
    );
    router.patch(
      '/requests/:id',
      allowed('update'),
      limit,
      describe(
        'updatePurchaseRequest',
        'Save draft content with business and lifecycle version checks',
        dataResponse(purchaseView),
      ),
      apiValidator('param', purchaseParams),
      apiValidator('json', purchaseUpdate),
      async (c) =>
        c.json({
          data: await service.update(
            c.req.valid('param').id,
            c.req.valid('json'),
            actor(c),
            access(c),
          ),
        }),
    );
    router.post(
      '/requests/:id/copy',
      allowed('create'),
      limit,
      describe(
        'copyCancelledPurchaseRequest',
        'Copy a cancelled request into a linked new draft using current rules',
        dataResponse(purchaseView),
        true,
      ),
      apiValidator('param', purchaseParams),
      apiValidator('json', purchaseUpdate),
      async (c) =>
        c.json(
          {
            data: await service.copy(
              c.req.valid('param').id,
              c.req.valid('json'),
              actor(c),
              access(c),
            ),
          },
          201,
        ),
    );
    // The action name comes from a code-owned path. Permission checks precede body validation.
    for (const transition of [
      'submit',
      'approve',
      'return',
      'withdraw',
      'revise',
      'cancel',
      'reassign',
    ] as const)
      router.post(
        `/requests/:id/${transition}`,
        allowed(
          transition === 'approve' || transition === 'return'
            ? 'review'
            : transition,
        ),
        limit,
        describe(
          `purchaseRequest${transition[0].toUpperCase()}${transition.slice(1)}`,
          `Apply the ${transition} purchase request action`,
          dataResponse(purchaseView),
        ),
        apiValidator('param', purchaseParams),
        apiValidator('json', purchaseAction.omit({ transition: true })),
        async (c) =>
          c.json({
            data: await service.fire(
              c.req.valid('param').id,
              { ...c.req.valid('json'), transition },
              actor(c),
              access(c),
            ),
          }),
      );
    for (const [path, settings] of [
      ['/requestCompanies', false],
      ['/settings/companies', true],
    ] as const)
      router.get(
        path,
        allowed('read', settings),
        describe(
          settings ? 'purchaseSettingsCompanies' : 'purchaseRequestCompanies',
          'Search authorized companies for purchase requests or review rules',
          listResponse(purchaseOptionView, purchaseCompanyMeta),
        ),
        apiValidator('query', purchasePage),
        async (c) =>
          c.json(
            await service.companies(c.req.valid('query'), access(c).policies),
          ),
      );
    router.get(
      '/requestOptions',
      allowed('read'),
      describe(
        'purchaseRequestOptions',
        'Search minimal authorized company personnel and organization options',
        listResponse(purchaseOptionView, purchaseMeta),
      ),
      apiValidator('query', purchaseOptionQuery),
      async (c) =>
        c.json(
          await service.options(c.req.valid('query'), actor(c), access(c)),
        ),
    );
    router.get(
      '/settings',
      allowed('read', true),
      describe(
        'purchaseSettings',
        'Read company purchase review rules and their revision',
        dataResponse(purchaseSettingsView),
      ),
      apiValidator('query', purchaseSettingsQuery),
      async (c) =>
        c.json({
          data: await service.settings(
            c.req.valid('query').subjectId,
            access(c).policies,
          ),
        }),
    );
    router.put(
      '/settings',
      allowed('update', true),
      limit,
      describe(
        'savePurchaseSettings',
        'Save the complete purchase review rule group with CAS and replay',
        dataResponse(purchaseSettingsView),
      ),
      apiValidator('json', purchaseSettingsSave),
      async (c) =>
        c.json({
          data: await service.saveSettings(
            c.req.valid('json'),
            actor(c),
            access(c).policies,
          ),
        }),
    );
    router.get(
      '/settings/options',
      allowed('read', true),
      describe(
        'purchaseSettingsOptions',
        'Search scoped review positions or eligible human accounts',
        listResponse(purchaseOptionView, purchaseMeta),
      ),
      apiValidator('query', purchaseOptionQuery),
      async (c) =>
        c.json(
          await service.options(
            c.req.valid('query'),
            actor(c),
            access(c),
            true,
          ),
        ),
    );
    const root = new Hono();
    root.route('/procurement', router);
    return root;
  });

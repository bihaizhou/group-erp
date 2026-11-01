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
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { bodyLimit } from 'hono/body-limit';
import { supplierServiceToken } from '../providers/procurement.js';
import type { SupplierAction } from '../providers/supplier-resources.js';
import type { MaterialPolicies } from '../providers/material-service.js';
import type { SupplierService } from '../providers/supplier-service.js';
import {
  supplierQuery,
  supplierPage,
  supplierCreate,
  supplierLink,
  supplierMutation,
  supplierIdentityUpdate,
  supplierRelationshipUpdate,
  supplierParams,
  supplierMeta,
  supplierView,
  supplierIdentityView,
  supplierAuditView,
  supplierCompanyView,
} from '../providers/supplier-model.js';
import { LifecycleError, lifecycleErrorFields } from '@nocobase/lifecycle';
import { z } from 'zod';
import {
  supplierApplicabilityInput,
  supplierApplicabilityView,
  supplierAvailabilityQuery,
  supplierAvailabilityView,
  supplierOverrideInput,
  supplierSelectionInput,
  supplierSelectionView,
} from '../providers/partner-applicability.js';

type Env = AuthEnv &
  AuthorizationEnv & { Variables: { supplierPolicies: MaterialPolicies } };
const errors = {
  ...apiErrorResponses,
  '400': apiErrorResponse(400),
  '404': apiErrorResponse(404),
  '409': apiErrorResponse(409),
};
export function createPartnerRoutes(
  app: Application,
  service: SupplierService,
  role: 'supplier' | 'customer',
) {
  const domain = role === 'customer' ? 'sales' : 'procurement';
  const partnerPath = (path: string) =>
    role === 'customer' ? path.replaceAll('supplier', 'customer') : path;
  const relationshipView = supplierView.extend({
    partnerRole: z.literal(role),
  });
  const roleApplicabilityView = supplierApplicabilityView.extend({
    partnerRole: z.literal(role),
  });
  const auth = app.container.resolve(authenticationToken);
  const authz = app.container.resolve(authorizationToken);
  const router = new Hono<Env>();
  const actor = (c: Context<Env>) => ({ id: c.get('auth')!.user.id });
  const policies = (c: Context<Env>) => c.get('supplierPolicies');
  const access = (action: SupplierAction) =>
    createMiddleware<Env>(async (c, next) => {
      const decision = await c.get('authz').authorize({
        resource: {
          type: 'composite',
          id: role === 'customer' ? 'sales.customers' : 'procurement.suppliers',
        },
        action,
      });
      if (decision.effect === 'deny' || !decision.conditions?.database)
        throw new ApiError({
          status: 'PERMISSION_DENIED',
          domain,
          reason:
            role === 'customer' ? 'CUSTOMER_FORBIDDEN' : 'SUPPLIER_FORBIDDEN',
          message: 'Partner access denied.',
        });
      c.set(
        'supplierPolicies',
        decision.conditions.database as MaterialPolicies,
      );
      await next();
    });
  for (const path of [
    partnerPath('/suppliers'),
    partnerPath('/suppliers/*'),
    partnerPath('/supplierLinks'),
    partnerPath('/supplierRoles'),
    partnerPath('/supplierCompanies'),
    partnerPath('/supplierCompanies/*'),
    partnerPath('/supplierAvailability'),
    partnerPath('/supplierAvailability/*'),
    partnerPath('/supplierOptions'),
    partnerPath('/supplierSelections'),
    partnerPath('/supplierOverrides'),
    partnerPath('/supplierScopeRegions'),
    partnerPath('/supplierScopeCompanies'),
    partnerPath('/supplierScopeIdentities'),
    partnerPath('/supplierScopeIdentities/*'),
    partnerPath('/supplierScopeReferences'),
    partnerPath('/supplierCapabilities/*'),
    partnerPath('/supplierIdentities'),
    partnerPath('/supplierIdentities/*'),
  ])
    router.use(path, auth.required(), authz.middleware());
  const limit = bodyLimit({
    maxSize: 32768,
    onError: () => {
      throw new ApiError({
        status: 'INVALID_ARGUMENT',
        httpStatus: 413,
        domain,
        reason: 'BODY_TOO_LARGE',
        message: 'Payload too large.',
      });
    },
  });
  const describe = (
    operationId: string,
    summary: string,
    response: ReturnType<typeof dataResponse>,
    mutation = false,
    create = false,
  ) =>
    describeRoute({
      tags: [role === 'customer' ? 'Sales customers' : 'Procurement suppliers'],
      operationId:
        role === 'customer'
          ? operationId
              .replaceAll('Procurement', 'Sales')
              .replaceAll('procurement', 'sales')
              .replaceAll('Supplier', 'Customer')
              .replaceAll('supplier', 'customer')
          : operationId,
      summary:
        role === 'customer'
          ? summary
              .replaceAll('supplier', 'customer')
              .replaceAll('Supplier', 'Customer')
          : summary,
      responses: {
        [create ? '201' : '200']: response,
        ...errors,
        ...(mutation ? { '413': apiErrorResponse(413) } : {}),
      },
    });
  router.onError((error, c) => {
    const lifecycle =
      error instanceof LifecycleError ? lifecycleErrorFields(error) : undefined;
    return apiErrorHandler(
      lifecycle ? new ApiError({ ...lifecycle, domain }) : error,
      c,
    );
  });
  router.get(
    partnerPath('/suppliers'),
    access('read'),
    describe(
      'procurementSuppliers',
      'List supplier relationships in one authorized company',
      listResponse(relationshipView, supplierMeta),
    ),
    apiValidator('query', supplierQuery),
    async (c) => c.json(await service.list(c.req.valid('query'), policies(c))),
  );
  for (const [path, onlyActive] of [
    [partnerPath('supplierAvailability'), false],
    [partnerPath('supplierOptions'), true],
  ] as const)
    router.get(
      `/${path}`,
      access('read'),
      describe(
        `procurement${onlyActive ? 'SupplierOptions' : 'SupplierAvailability'}`,
        'Resolve current supplier applicability and company availability without creating inherited relationships',
        listResponse(supplierAvailabilityView, supplierMeta),
      ),
      apiValidator('query', supplierAvailabilityQuery),
      async (c) =>
        c.json(
          await service.availability(
            c.req.valid('query'),
            policies(c),
            onlyActive,
          ),
        ),
    );
  router.get(
    partnerPath('/supplierCompanies/:id'),
    access('read'),
    describe(
      'procurementSupplierCompany',
      'Read the selected authorized active company',
      dataResponse(supplierCompanyView),
    ),
    apiValidator('param', supplierParams),
    async (c) =>
      c.json({
        data: await service.companyDetail(c.req.valid('param').id, policies(c)),
      }),
  );
  router.get(
    partnerPath('/supplierCapabilities/:id'),
    // No base read requirement: global master/scope maintainers may have no
    // company read grant. Each flag uses its independent action decision.
    apiValidator('param', supplierParams),
    apiValidator(
      'query',
      z.strictObject({ subjectId: z.string().uuid().optional() }),
    ),
    describe(
      'procurementSupplierCapabilities',
      'Read authorized supplier maintenance capabilities',
      dataResponse(
        z.object({
          updateIdentity: z.boolean(),
          configureApplicability: z.boolean(),
          updateRelationship: z.boolean(),
        }),
      ),
    ),
    async (c) => {
      const entries = await Promise.all(
        (
          [
            'updateIdentity',
            'configureApplicability',
            'updateRelationship',
          ] as const
        ).map(async (action) => {
          const decision = await c.get('authz').authorize({
            resource: {
              type: 'composite',
              id:
                role === 'customer'
                  ? 'sales.customers'
                  : 'procurement.suppliers',
            },
            action,
          });
          const allowed =
            decision.effect !== 'deny' && decision.conditions?.database
              ? await service.canManage(
                  action,
                  c.req.valid('param').id,
                  c.req.valid('query').subjectId,
                  decision.conditions.database,
                )
              : false;
          return [action, allowed] as const;
        }),
      );
      return c.json({ data: Object.fromEntries(entries) });
    },
  );
  router.get(
    partnerPath('/supplierScopeIdentities/:id'),
    access('configureApplicability'),
    describe(
      'procurementSupplierScopeIdentity',
      'Read supplier identity for scope maintenance',
      dataResponse(supplierIdentityView),
    ),
    apiValidator('param', supplierParams),
    async (c) =>
      c.json({
        data: await service.identityDetail(
          c.req.valid('param').id,
          policies(c),
        ),
      }),
  );
  router.get(
    partnerPath('/supplierScopeIdentities'),
    access('configureApplicability'),
    describe(
      'procurementSupplierScopeIdentities',
      'Search shared identities for supplier scope maintenance',
      listResponse(supplierIdentityView, supplierMeta),
    ),
    apiValidator('query', supplierPage),
    async (c) =>
      c.json(await service.identities(c.req.valid('query'), policies(c))),
  );
  router.get(
    partnerPath('/supplierScopeReferences'),
    access('configureApplicability'),
    describe(
      'procurementSupplierScopeReferences',
      'Resolve selected scope labels including inactive records',
      dataResponse(
        z.object({
          regions: z.array(supplierCompanyView.extend({ status: z.string() })),
          companies: z.array(
            supplierCompanyView.extend({ status: z.string() }),
          ),
        }),
      ),
    ),
    apiValidator(
      'query',
      z.strictObject({
        regionId: z
          .union([z.string().uuid(), z.array(z.string().uuid()).max(500)])
          .optional(),
        subjectId: z
          .union([z.string().uuid(), z.array(z.string().uuid()).max(500)])
          .optional(),
      }),
    ),
    async (c) => {
      const q = c.req.valid('query');
      const ids = (v: string | string[] | undefined) =>
        v ? (Array.isArray(v) ? v : [v]) : [];
      return c.json({
        data: await service.scopeReferences(
          ids(q.regionId),
          ids(q.subjectId),
          policies(c),
        ),
      });
    },
  );
  router.get(
    partnerPath('/supplierScopeRegions'),
    access('configureApplicability'),
    describe(
      'procurementSupplierScopeRegions',
      'Search authorized active regions for applicability configuration',
      listResponse(
        z.object({
          id: z.string(),
          code: z.string(),
          name: z.string(),
          parentId: z.string().nullable(),
        }),
        supplierMeta,
      ),
    ),
    apiValidator('query', supplierPage),
    async (c) =>
      c.json(await service.scopeRegions(c.req.valid('query'), policies(c))),
  );
  router.get(
    partnerPath('/supplierScopeCompanies'),
    access('configureApplicability'),
    describe(
      'procurementSupplierScopeCompanies',
      'Search authorized active companies for applicability configuration',
      listResponse(supplierCompanyView, supplierMeta),
    ),
    apiValidator('query', supplierPage),
    async (c) =>
      c.json(await service.companies(c.req.valid('query'), policies(c))),
  );
  router.get(
    partnerPath('/supplierIdentities/:id/applicability'),
    access('configureApplicability'),
    describe(
      'procurementSupplierApplicability',
      'Read supplier applicability independently from shared identity and local overrides',
      dataResponse(roleApplicabilityView),
    ),
    apiValidator('param', supplierParams),
    async (c) =>
      c.json({
        data: await service.applicability(c.req.valid('param').id, policies(c)),
      }),
  );
  router.put(
    partnerPath('/supplierIdentities/:id/applicability'),
    access('configureApplicability'),
    limit,
    describe(
      'configureProcurementSupplierApplicability',
      'Configure all project companies or a union of regions and explicit companies',
      dataResponse(roleApplicabilityView),
      true,
    ),
    apiValidator('param', supplierParams),
    apiValidator('json', supplierApplicabilityInput),
    async (c) =>
      c.json({
        data: await service.configureApplicability(
          c.req.valid('param').id,
          c.req.valid('json'),
          actor(c),
          policies(c),
        ),
      }),
  );
  for (const transition of ['deactivate', 'reactivate'] as const)
    router.post(
      partnerPath(`/supplierIdentities/:id/applicability/${transition}`),
      access('configureApplicability'),
      limit,
      describe(
        `${transition}ProcurementSupplierRole`,
        'Change supplier availability for all companies while retaining local exclusions',
        dataResponse(roleApplicabilityView),
        true,
      ),
      apiValidator('param', supplierParams),
      apiValidator('json', supplierMutation),
      async (c) =>
        c.json({
          data: await service.changeSupplierStatus(
            c.req.valid('param').id,
            transition,
            c.req.valid('json'),
            actor(c),
            policies(c),
          ),
        }),
    );
  router.post(
    partnerPath('/supplierOverrides'),
    access('updateRelationship'),
    limit,
    describe(
      'overrideProcurementSupplierCompany',
      'Disable or restore one company within existing supplier applicability',
      dataResponse(relationshipView),
      true,
    ),
    apiValidator('json', supplierOverrideInput),
    async (c) =>
      c.json({
        data: await service.overrideCompany(
          c.req.valid('json'),
          actor(c),
          policies(c),
        ),
      }),
  );
  router.post(
    partnerPath('/supplierSelections'),
    access('read'),
    limit,
    describe(
      'procurementSupplierSelection',
      'Revalidate supplier scope and availability in a transaction without saving a purchase request',
      dataResponse(supplierSelectionView),
      true,
    ),
    apiValidator('json', supplierSelectionInput),
    async (c) =>
      c.json({
        data: await service.resolveSupplier(
          c.req.valid('json').subjectId,
          c.req.valid('json').partnerId,
          policies(c),
        ),
      }),
  );
  router.get(
    partnerPath('/supplierIdentities/:id/applicability/history'),
    access('configureApplicability'),
    describe(
      'procurementSupplierApplicabilityHistory',
      'Read applicability and global supplier availability audit',
      listResponse(supplierAuditView, supplierMeta),
    ),
    apiValidator('param', supplierParams),
    apiValidator('query', supplierPage),
    async (c) =>
      c.json(
        await service.applicabilityHistory(
          c.req.valid('param').id,
          c.req.valid('query'),
          policies(c),
        ),
      ),
  );
  router.get(
    partnerPath('/supplierAvailability/:id'),
    access('read'),
    describe(
      'procurementSupplierAvailabilityDetail',
      'Read an applicable supplier in the authorized company without creating a company override',
      dataResponse(supplierAvailabilityView),
    ),
    apiValidator('param', supplierParams),
    apiValidator('query', z.strictObject({ subjectId: z.string().uuid() })),
    async (c) =>
      c.json({
        data: await service.availabilityDetail(
          c.req.valid('param').id,
          c.req.valid('query').subjectId,
          policies(c),
        ),
      }),
  );
  router.get(
    partnerPath('/supplierCompanies'),
    access('read'),
    describe(
      'procurementSupplierCompanies',
      'Search authorized active companies for supplier maintenance',
      listResponse(supplierCompanyView, supplierMeta),
    ),
    apiValidator('query', supplierPage),
    async (c) =>
      c.json(await service.companies(c.req.valid('query'), policies(c))),
  );
  router.get(
    partnerPath('/supplierIdentities'),
    access('updateIdentity'),
    describe(
      'procurementSupplierIdentities',
      'Search shared identities for independently authorized master-data maintainers',
      listResponse(supplierIdentityView, supplierMeta),
    ),
    apiValidator('query', supplierPage),
    async (c) =>
      c.json(await service.identities(c.req.valid('query'), policies(c))),
  );
  router.get(
    partnerPath('/supplierIdentities/:id'),
    access('updateIdentity'),
    describe(
      'procurementSupplierIdentity',
      'Read the latest shared identity for maintenance',
      dataResponse(supplierIdentityView),
    ),
    apiValidator('param', supplierParams),
    async (c) =>
      c.json({
        data: await service.identityDetail(
          c.req.valid('param').id,
          policies(c),
        ),
      }),
  );
  router.get(
    partnerPath('/supplierIdentities/:id/history'),
    access('updateIdentity'),
    describe(
      'procurementSupplierIdentityHistory',
      'Read shared-identity audit for master-data maintenance',
      listResponse(supplierAuditView, supplierMeta),
    ),
    apiValidator('param', supplierParams),
    apiValidator('query', supplierPage),
    async (c) =>
      c.json(
        await service.identityHistory(
          c.req.valid('param').id,
          c.req.valid('query'),
          policies(c),
        ),
      ),
  );
  router.get(
    partnerPath('/suppliers/:id'),
    access('read'),
    describe(
      'procurementSupplier',
      'Read one authorized supplier relationship and shared identity',
      dataResponse(relationshipView),
    ),
    apiValidator('param', supplierParams),
    async (c) =>
      c.json({
        data: await service.detail(c.req.valid('param').id, policies(c)),
      }),
  );
  router.get(
    partnerPath('/suppliers/:id/history'),
    access('read'),
    describe(
      'procurementSupplierHistory',
      'Read authorized company relationship audit',
      listResponse(supplierAuditView, supplierMeta),
    ),
    apiValidator('param', supplierParams),
    apiValidator('query', supplierPage),
    async (c) =>
      c.json(
        await service.history(
          c.req.valid('param').id,
          c.req.valid('query'),
          policies(c),
        ),
      ),
  );
  router.post(
    partnerPath('/suppliers'),
    access('create'),
    limit,
    describe(
      'createProcurementSupplier',
      'Atomically create a supplier identity and its first company relationship',
      dataResponse(relationshipView),
      true,
      true,
    ),
    apiValidator('json', supplierCreate),
    async (c) =>
      c.json(
        {
          data: await service.create(
            c.req.valid('json'),
            actor(c),
            policies(c),
          ),
        },
        201,
      ),
  );
  router.post(
    partnerPath('/supplierRoles'),
    access('addRole'),
    limit,
    describe(
      'addProcurementSupplierRole',
      'Add an independent partner role to an existing shared identity',
      dataResponse(relationshipView),
      true,
      true,
    ),
    apiValidator('json', supplierLink),
    async (c) =>
      c.json(
        {
          data: await service.addRole(
            c.req.valid('json'),
            actor(c),
            policies(c),
          ),
        },
        201,
      ),
  );
  router.get(
    partnerPath('/supplierRoles'),
    access('addRole'),
    describe(
      'procurementSupplierRoleCandidates',
      'Search minimal shared identities for adding this independent partner role',
      listResponse(
        z.object({
          id: z.string().uuid(),
          code: z.string(),
          name: z.string(),
          available: z.boolean(),
        }),
        supplierMeta,
      ),
    ),
    apiValidator('query', supplierPage),
    async (c) => {
      const result = await service.identities(
          c.req.valid('query'),
          policies(c),
        ),
        conn = app.container.resolve(databaseManagerToken).connection(),
        data = [];
      for (const identity of result.data)
        data.push({
          id: identity.id,
          code: identity.code,
          name: identity.name,
          available:
            identity.status === 'active' &&
            !(await conn.repository('partnerRolePolicies').exists({
              filter: { partnerId: identity.id, partnerRole: role },
            })),
        });
      return c.json({ data, meta: result.meta });
    },
  );
  router.post(
    partnerPath('/supplierLinks'),
    access('linkIdentity'),
    limit,
    describe(
      'linkProcurementSupplier',
      'Link an existing active shared identity to an authorized company',
      dataResponse(relationshipView),
      true,
      true,
    ),
    apiValidator('json', supplierLink),
    async (c) =>
      c.json(
        {
          data: await service.link(c.req.valid('json'), actor(c), policies(c)),
        },
        201,
      ),
  );
  router.patch(
    partnerPath('/suppliers/:id'),
    access('updateRelationship'),
    limit,
    describe(
      'updateProcurementSupplier',
      'Update company relationship notes with a version and reason',
      dataResponse(relationshipView),
      true,
    ),
    apiValidator('param', supplierParams),
    apiValidator('json', supplierRelationshipUpdate),
    async (c) =>
      c.json({
        data: await service.updateRelationship(
          c.req.valid('param').id,
          c.req.valid('json'),
          actor(c),
          policies(c),
        ),
      }),
  );
  router.patch(
    partnerPath('/supplierIdentities/:id'),
    access('updateIdentity'),
    limit,
    describe(
      'updateProcurementSupplierIdentity',
      'Update a shared supplier identity with independent maintenance permission',
      dataResponse(supplierIdentityView),
      true,
    ),
    apiValidator('param', supplierParams),
    apiValidator('json', supplierIdentityUpdate),
    async (c) =>
      c.json({
        data: await service.updateIdentity(
          c.req.valid('param').id,
          c.req.valid('json'),
          actor(c),
          policies(c),
        ),
      }),
  );
  for (const [path, table, action, schema] of [
    [
      partnerPath('suppliers'),
      'partnerSubjectSettings',
      'updateRelationship',
      relationshipView,
    ],
    [
      partnerPath('supplierIdentities'),
      'businessPartners',
      'updateIdentity',
      supplierIdentityView,
    ],
  ] as const)
    for (const transition of ['deactivate', 'reactivate'] as const) {
      router.post(
        `/${path}/:id/${transition}`,
        access(action),
        limit,
        describe(
          `${transition}Procurement${path === partnerPath('suppliers') ? 'Supplier' : 'SupplierIdentity'}`,
          `Change ${path} availability through its lifecycle`,
          dataResponse(schema),
          true,
        ),
        apiValidator('param', supplierParams),
        apiValidator('json', supplierMutation),
        async (c) =>
          c.json({
            data: await service.changeStatus(
              table,
              c.req.valid('param').id,
              transition,
              c.req.valid('json'),
              actor(c),
              policies(c),
            ),
          }),
      );
    }
  const root = new Hono();
  root.route(role === 'customer' ? '/sales' : '/procurement', router);
  return root;
}

export const procurementSupplierRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) =>
    createPartnerRoutes(
      app,
      app.container.resolve(supplierServiceToken),
      'supplier',
    ),
  );

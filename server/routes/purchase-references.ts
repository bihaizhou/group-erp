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
  apiErrorResponses,
  apiErrorResponse,
  apiValidator,
  dataResponse,
  defineApiRoutes,
  describeRoute,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import type { MaterialPolicies } from '../providers/material-service.js';
import {
  purchaseReferenceQuery,
  purchaseReferenceView,
  purchaseReferenceImpact,
} from '../providers/purchase-reference-service.js';
import { supplierServiceToken } from '../providers/procurement.js';

export const purchaseReferenceRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const router = new Hono<AuthEnv & AuthorizationEnv>();
    const path = '/procurement/referenceImpacts';
    router.use(
      path,
      app.container.resolve(authenticationToken).required(),
      app.container.resolve(authorizationToken).middleware(),
    );
    router.onError(apiErrorHandler);
    router.get(
      path,
      describeRoute({
        tags: ['Procurement requests'],
        operationId: 'getPurchaseReferenceImpacts',
        summary:
          'Read authorized open purchase references of a maintenance target',
        responses: {
          '200': dataResponse(purchaseReferenceView),
          ...apiErrorResponses,
          '400': apiErrorResponse(400),
          '404': apiErrorResponse(404),
        },
      }),
      apiValidator('query', purchaseReferenceQuery),
      async (c) => {
        const target = c.req.valid('query');
        const context = c.get('authz');
        let ownerPolicies: MaterialPolicies | undefined;
        if (target.domain === 'organization') {
          await context.require({
            resource: { type: 'settings', id: 'organization' },
            action: 'read',
          });
        } else {
          const resource =
            target.domain === 'suppliers'
              ? 'procurement.suppliers'
              : `${target.domain === 'people' ? 'people' : 'materials'}.${target.kind}`;
          const action =
            target.domain !== 'suppliers'
              ? 'read'
              : target.kind === 'identity'
                ? 'updateIdentity'
                : target.kind === 'applicability'
                  ? 'configureApplicability'
                  : 'updateRelationship';
          const decision = await context.authorize({
            resource: { type: 'composite', id: resource },
            action,
          });
          if (decision.effect === 'deny' || !decision.conditions?.database)
            throw new ApiError({
              status: 'PERMISSION_DENIED',
              reason: 'PURCHASE_REFERENCE_FORBIDDEN',
              domain: 'procurement',
              message: 'Maintenance target is not permitted.',
            });
          ownerPolicies = decision.conditions.database;
          if (
            target.domain === 'suppliers' &&
            target.kind === 'company' &&
            target.subjectId
          )
            await app.container
              .resolve(supplierServiceToken)
              .availabilityDetail(target.id, target.subjectId, ownerPolicies);
        }
        const decision = await context.authorize({
          resource: { type: 'composite', id: 'procurement.requests' },
          action: 'read',
        });
        const purchasePolicies =
          decision.effect !== 'deny' && decision.conditions?.database
            ? (decision.conditions.database as MaterialPolicies)
            : undefined;
        const data = await purchaseReferenceImpact(
          app.container.resolve(databaseManagerToken).connection(),
          target,
          ownerPolicies,
          purchasePolicies,
          app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai',
        );
        return c.json({ data });
      },
    );
    const root = new Hono();
    root.route('/', router);
    return root;
  });

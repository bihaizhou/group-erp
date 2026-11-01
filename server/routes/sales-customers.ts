import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { createPartnerRoutes } from './procurement-suppliers.js';
import { customerServiceToken } from '../providers/execution.js';

export const salesCustomerRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) =>
    createPartnerRoutes(
      app,
      app.container.resolve(customerServiceToken),
      'customer',
    ),
  );

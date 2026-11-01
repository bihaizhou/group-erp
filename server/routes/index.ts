import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';
import { accountRoutes } from './account.js';
import { organizationRoutes } from './organization.js';
import { peopleRoutes } from './people.js';
import { materialRoutes } from './materials.js';
import { supplyChainRoutes } from './supply-chain.js';
import { procurementSupplierRoutes } from './procurement-suppliers.js';
import { procurementRequestRoutes } from './procurement-requests.js';
import { requisitionsRequestRoutes } from './requisitions.js';
import { purchaseReferenceRoutes } from './purchase-references.js';
import { materialSourceRoutes } from './material-sources.js';
import { salesCustomerRoutes } from './sales-customers.js';
import { tradeOrderRoutes } from './trade-orders.js';
import { executionSettingsRoutes } from './execution-settings.js';
import { warehouseRoutes } from './warehouse.js';
import { inventoryRoutes } from './inventory.js';
import { executionReferenceRoutes } from './execution-references.js';
import { hseRoutes } from './hse.js';
import { productionRoutes } from './production.js';
import { operationsRoutes } from './operations.js';
import { positionPermissionRoutes } from './position-permissions.js';
import { assetRoutes } from './assets.js';
import {
  supplyChainFileApiGuard,
  supplyChainFileContentGuard,
  supplyChainFileRoutes,
} from './supply-chain-files.js';
import {
  peoplePhotoApiGuard,
  peoplePhotoContentGuard,
  peoplePhotoRoutes,
} from './people-files.js';

const routes: readonly AppRouteContribution<Application>[] = [
  accountRoutes,
  organizationRoutes,
  peopleRoutes,
  materialRoutes,
  supplyChainRoutes,
  procurementSupplierRoutes,
  procurementRequestRoutes,
  requisitionsRequestRoutes,
  purchaseReferenceRoutes,
  materialSourceRoutes,
  salesCustomerRoutes,
  tradeOrderRoutes,
  executionSettingsRoutes,
  warehouseRoutes,
  inventoryRoutes,
  executionReferenceRoutes,
  hseRoutes,
  productionRoutes,
  operationsRoutes,
  positionPermissionRoutes,
  assetRoutes,
  supplyChainFileApiGuard,
  supplyChainFileContentGuard,
  ...supplyChainFileRoutes,
  peoplePhotoApiGuard,
  peoplePhotoContentGuard,
  ...peoplePhotoRoutes,
];

export default routes;

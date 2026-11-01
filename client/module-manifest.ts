import type { AppClientRouteDefinition } from '@nocobase/app-client/plugins';
import { warehouseRoutes } from './pages/materials/routes.js';
import { procurementRoutes } from './pages/suppliers/routes.js';
import { requisitionsRoutes } from './pages/requisitions/routes.js';
import { salesRoutes } from './pages/execution/routes.js';
import { hseRoutes } from './pages/hse/routes.js';
import { productionRoutes } from './pages/production/routes.js';
import { operationsRoutes } from './pages/operations/routes.js';
import { assetsRoutes } from './pages/assets/routes.js';

export interface FunctionModuleManifest {
  readonly id: string;
  readonly routes: readonly AppClientRouteDefinition[];
}

/**
 * One ordered list of the business modules under `functions`. The route tree
 * and therefore the sidebar are expanded from this list; a new module is
 * registered here, not spliced into `routes.ts` by hand.
 */
export const functionModules: readonly FunctionModuleManifest[] = [
  { id: 'warehouse', routes: warehouseRoutes },
  { id: 'procurement', routes: procurementRoutes },
  { id: 'requisitions', routes: requisitionsRoutes },
  { id: 'sales', routes: salesRoutes },
  { id: 'hse', routes: hseRoutes },
  { id: 'production', routes: productionRoutes },
  { id: 'operations', routes: operationsRoutes },
  { id: 'assets', routes: assetsRoutes },
];

export const functionModuleRoutes: AppClientRouteDefinition[] =
  functionModules.flatMap((module) => [...module.routes]);

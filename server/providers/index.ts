import type { ApplicationServiceProviderConstructor } from '@nocobase/app-server/application';
import OrganizationProvider from './organization.js';
import PeopleProvider from './people.js';
import MaterialsProvider from './materials.js';
import SupplyChainProvider from './supply-chain.js';
import ProcurementProvider from './procurement.js';
import RequisitionsProvider from './requisitions.js';
import MaterialSourcesProvider from './material-sources.js';
import SupplyChainFilesProvider from './supply-chain-files.js';
import ExecutionProvider from './execution.js';
import HseProvider from './hse.js';
import ProductionProvider from './production.js';
import OperationsProvider from './operations.js';
import AssetsProvider from './assets.js';

const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  OrganizationProvider,
  PeopleProvider,
  MaterialsProvider,
  SupplyChainProvider,
  ProcurementProvider,
  RequisitionsProvider,
  MaterialSourcesProvider,
  SupplyChainFilesProvider,
  ExecutionProvider,
  HseProvider,
  ProductionProvider,
  OperationsProvider,
  AssetsProvider,
];

export default serviceProviders;

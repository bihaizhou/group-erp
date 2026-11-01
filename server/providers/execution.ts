import type { Application } from '@nocobase/app-server/application';
import {
  ServiceProvider,
  createServiceToken,
} from '@nocobase/service-provider';
import { databaseManagerToken } from '@nocobase/db';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { recordLifecycleToken } from './record-lifecycle.js';
import { supplierServiceToken } from './procurement.js';
import { issueRequestServiceToken } from './requisitions.js';
import { supplyChainMaterialServiceToken } from './supply-chain.js';
import { SupplierService } from './supplier-service.js';
import { InventoryService } from './inventory-service.js';
import { ExecutionRecords } from './execution-records.js';
import { ExecutionReviewService } from './execution-review-service.js';
import { TradeOrderService } from './trade-order-service.js';
import { WarehouseService } from './warehouse-service.js';
import { StockTransferService } from './stock-transfer-service.js';
import { StockCountService } from './stock-count-service.js';
import { InventoryReadService } from './inventory-read-service.js';
import {
  customerResource,
  executionResources,
  executionColumns,
  inventoryResource,
  executionSettingsResource,
  executionCompanyAccess,
  executionWarehouseAccess,
  executionOwnCompanyAccess,
} from './execution-resources.js';

export const customerServiceToken = createServiceToken<SupplierService>(
  'group-erp/customers',
);
export const inventoryServiceToken = createServiceToken<InventoryService>(
  'group-erp/inventory',
);
export const executionRecordsToken = createServiceToken<ExecutionRecords>(
  'group-erp/execution-records',
);
export const executionReviewServiceToken =
  createServiceToken<ExecutionReviewService>('group-erp/execution-review');
export const tradeOrderServiceToken = createServiceToken<TradeOrderService>(
  'group-erp/trade-orders',
);
export const warehouseServiceToken = createServiceToken<WarehouseService>(
  'group-erp/warehouse',
);
export const stockTransferServiceToken =
  createServiceToken<StockTransferService>('group-erp/transfers');
export const stockCountServiceToken =
  createServiceToken<StockCountService>('group-erp/counts');
export const inventoryReadServiceToken =
  createServiceToken<InventoryReadService>('group-erp/inventory-reads');
export default class ExecutionProvider extends ServiceProvider<Application> {
  readonly name = 'group-erp/supply-chain-execution';
  override register() {
    const db = () => this.app.container.resolve(databaseManagerToken),
      runtime = () => this.app.container.resolve(recordLifecycleToken),
      users = () => this.app.container.resolve(userAdministrationServiceToken),
      timeZone =
        this.app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai';
    this.app.container.singleton(customerServiceToken, () => {
      this.app.container.resolve(supplierServiceToken);
      return new SupplierService(db(), runtime(), 'customer');
    });
    this.app.container.singleton(
      inventoryServiceToken,
      () => new InventoryService(db()),
    );
    this.app.container.singleton(
      executionRecordsToken,
      () => new ExecutionRecords(db(), runtime(), users(), timeZone),
    );
    this.app.container.singleton(
      executionReviewServiceToken,
      () => new ExecutionReviewService(db(), runtime(), users(), timeZone),
    );
    this.app.container.singleton(
      tradeOrderServiceToken,
      () =>
        new TradeOrderService(
          this.app.container.resolve(executionRecordsToken),
          this.app.container.resolve(executionReviewServiceToken),
          this.app.container.resolve(supplyChainMaterialServiceToken),
          this.app.container.resolve(supplierServiceToken),
          this.app.container.resolve(customerServiceToken),
        ),
    );
    this.app.container.singleton(
      warehouseServiceToken,
      () =>
        new WarehouseService(
          this.app.container.resolve(executionRecordsToken),
          this.app.container.resolve(executionReviewServiceToken),
          this.app.container.resolve(inventoryServiceToken),
          this.app.container.resolve(supplyChainMaterialServiceToken),
          this.app.container.resolve(issueRequestServiceToken),
          this.app.container.resolve(supplierServiceToken),
          this.app.container.resolve(customerServiceToken),
        ),
    );
    this.app.container.singleton(
      stockTransferServiceToken,
      () =>
        new StockTransferService(
          this.app.container.resolve(executionRecordsToken),
          this.app.container.resolve(executionReviewServiceToken),
          this.app.container.resolve(supplyChainMaterialServiceToken),
        ),
    );
    this.app.container.singleton(
      stockCountServiceToken,
      () =>
        new StockCountService(
          this.app.container.resolve(executionRecordsToken),
          this.app.container.resolve(executionReviewServiceToken),
          this.app.container.resolve(inventoryServiceToken),
          this.app.container.resolve(supplyChainMaterialServiceToken),
        ),
    );
    this.app.container.singleton(
      inventoryReadServiceToken,
      () =>
        new InventoryReadService(
          this.app.container.resolve(executionRecordsToken),
          this.app.container.resolve(inventoryServiceToken),
        ),
    );
  }
  override async boot() {
    const authz = this.app.container.resolve(authorizationToken);
    for (const name of Object.keys(executionColumns))
      authz.database.collections.add({
        name,
        title: { key: `execution.collections.${name}`, ns: 'group-erp' },
      });
    authz.recordAccess.define(executionCompanyAccess);
    authz.recordAccess.define(executionWarehouseAccess);
    authz.recordAccess.define(
      executionOwnCompanyAccess(
        this.app.container.resolve(databaseManagerToken),
        this.app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai',
      ),
    );
    authz.ui.sections.add({
      name: 'group-erp.sales',
      title: { key: 'execution.sales', ns: 'group-erp' },
      parent: 'business',
    });
    authz.ui.sections.add({
      name: 'group-erp.warehouse',
      title: { key: 'execution.warehouse', ns: 'group-erp' },
      parent: 'business',
    });
    for (const resource of [
      ...executionResources,
      inventoryResource,
      executionSettingsResource,
      customerResource,
    ]) {
      authz.ui.place(authz.compositeResources.define(resource), {
        section: resource.name.startsWith('procurement.')
          ? 'group-erp.procurement'
          : resource.name.startsWith('sales.')
            ? 'group-erp.sales'
            : 'group-erp.warehouse',
      });
    }
    this.app.container.resolve(tradeOrderServiceToken);
    this.app.container.resolve(warehouseServiceToken);
    this.app.container.resolve(stockTransferServiceToken);
    this.app.container.resolve(stockCountServiceToken);
  }
}

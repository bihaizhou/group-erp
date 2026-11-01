import type { Application } from '@nocobase/app-server/application';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import {
  ServiceProvider,
  createServiceToken,
} from '@nocobase/service-provider';
import { SupplierService } from './supplier-service.js';
import {
  supplierResource,
  supplierCompanyAccess,
  supplierOwnCompanyAccess,
} from './supplier-resources.js';
import { recordLifecycleToken } from './record-lifecycle.js';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { PurchaseRequestService } from './purchase-request-service.js';
import { supplyChainMaterialServiceToken } from './supply-chain.js';
import {
  purchaseResource,
  purchaseSettingsResource,
  purchaseCompanyAccess,
  purchaseOwnAccess,
  purchaseOwnCompanyAccess,
} from './purchase-request-resources.js';

export const supplierServiceToken = createServiceToken<SupplierService>(
  'group-erp/procurement-suppliers',
);
export const purchaseRequestServiceToken =
  createServiceToken<PurchaseRequestService>('group-erp/purchase-requests');
export default class ProcurementProvider extends ServiceProvider<Application> {
  public readonly name = 'group-erp/procurement';
  public override register() {
    this.app.container.singleton(
      supplierServiceToken,
      () =>
        new SupplierService(
          this.app.container.resolve(databaseManagerToken),
          this.app.container.resolve(recordLifecycleToken),
          'supplier',
          this.app.container.resolve(userAdministrationServiceToken),
        ),
    );
    this.app.container.singleton(
      purchaseRequestServiceToken,
      () =>
        new PurchaseRequestService(
          this.app.container.resolve(databaseManagerToken),
          this.app.container.resolve(recordLifecycleToken),
          this.app.container.resolve(supplierServiceToken),
          this.app.container.resolve(supplyChainMaterialServiceToken),
          this.app.container.resolve(userAdministrationServiceToken),
          this.app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai',
        ),
    );
  }
  public override async boot() {
    const authz = this.app.container.resolve(authorizationToken);
    for (const name of [
      'businessPartners',
      'partnerSubjectSettings',
      'supplyChainAudit',
      'partnerRolePolicies',
      'partnerRegionScopes',
      'partnerCompanyScopes',
      'orgRegions',
    ])
      authz.database.collections.add({
        name,
        title: { key: 'procurement.suppliers', ns: 'group-erp' },
      });
    for (const name of [
      'purchaseRequests',
      'purchaseRequestLines',
      'supplyChainRequestVersions',
      'supplyChainReviewTasks',
    ])
      authz.database.collections.add({
        name,
        title: { key: 'procurement.purchase.title', ns: 'group-erp' },
      });
    authz.recordAccess.define(supplierCompanyAccess);
    authz.recordAccess.define(purchaseCompanyAccess);
    authz.recordAccess.define(purchaseOwnAccess);
    authz.recordAccess.define(
      purchaseOwnCompanyAccess(
        this.app.container.resolve(databaseManagerToken),
        this.app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai',
      ),
    );
    authz.recordAccess.define(
      supplierOwnCompanyAccess(
        this.app.container.resolve(databaseManagerToken),
        this.app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai',
      ),
    );
    authz.ui.sections.add({
      name: 'group-erp.procurement',
      title: { key: 'procurement.title', ns: 'group-erp' },
      parent: 'business',
    });
    authz.ui.place(authz.compositeResources.define(supplierResource), {
      section: 'group-erp.procurement',
    });
    for (const resource of [purchaseResource, purchaseSettingsResource])
      authz.ui.place(authz.compositeResources.define(resource), {
        section: 'group-erp.procurement',
      });
  }
}

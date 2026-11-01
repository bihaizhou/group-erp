import type { Application } from '@nocobase/app-server/application';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import {
  ServiceProvider,
  createServiceToken,
} from '@nocobase/service-provider';
import { materialServiceToken } from './materials.js';
import { SupplyChainMaterialService } from './supply-chain-material-service.js';
import {
  businessMaterialResources,
  supplyChainCompanyAccess,
  supplyChainOwnCompanyAccess,
} from './supply-chain-resources.js';

export const supplyChainMaterialServiceToken =
  createServiceToken<SupplyChainMaterialService>(
    'group-erp/supply-chain-materials',
  );
export default class SupplyChainProvider extends ServiceProvider<Application> {
  public readonly name = 'group-erp/supply-chain';
  public override register() {
    this.app.container.singleton(
      supplyChainMaterialServiceToken,
      () =>
        new SupplyChainMaterialService(
          this.app.container.resolve(databaseManagerToken),
          this.app.container.resolve(materialServiceToken),
        ),
    );
  }
  public override async boot() {
    const authz = this.app.container.resolve(authorizationToken);
    for (const access of [
      ...supplyChainCompanyAccess,
      ...supplyChainOwnCompanyAccess(
        this.app.container.resolve(databaseManagerToken),
        this.app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai',
      ),
    ])
      authz.recordAccess.define(access);
    authz.ui.sections.add({
      name: 'group-erp.supply-chain',
      title: { key: 'supplyChain.title', ns: 'group-erp' },
      parent: 'business',
    });
    for (const resource of businessMaterialResources)
      authz.ui.place(authz.compositeResources.define(resource), {
        section: 'group-erp.supply-chain',
      });
  }
}

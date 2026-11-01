import type { Application } from '@nocobase/app-server/application';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import {
  ServiceProvider,
  createServiceToken,
} from '@nocobase/service-provider';
import { materialTables } from './material-model.js';
import { MaterialService } from './material-service.js';
import {
  materialResources,
  materialCatalogResource,
  materialHistoryResource,
  materialOwnRequests,
  materialCompanyAccess,
  materialOwnCompanyAccess,
} from './material-resources.js';
import { recordLifecycleToken } from './record-lifecycle.js';

export const materialServiceToken = createServiceToken<MaterialService>(
  'group-erp/materials',
);
export default class MaterialsProvider extends ServiceProvider<Application> {
  public readonly name = 'group-erp/materials';
  public override register() {
    this.app.container.singleton(
      materialServiceToken,
      () =>
        new MaterialService(
          this.app.container.resolve(databaseManagerToken),
          this.app.container.resolve(recordLifecycleToken),
        ),
    );
  }
  public override async boot() {
    const authz = this.app.container.resolve(authorizationToken);
    for (const name of [...Object.values(materialTables), 'materialAudit'])
      authz.database.collections.add({
        name,
        title: { key: 'materials.title', ns: 'group-erp' },
      });
    authz.recordAccess.define(materialOwnRequests);
    authz.recordAccess.define(materialCompanyAccess);
    for (const scope of materialOwnCompanyAccess(
      this.app.container.resolve(databaseManagerToken),
      this.app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai',
    ))
      authz.recordAccess.define(scope);
    authz.ui.sections.add({
      name: 'group-erp.materials',
      title: { key: 'materials.title', ns: 'group-erp' },
      parent: 'business',
    });
    for (const resource of [
      ...Object.values(materialResources),
      materialCatalogResource,
      materialHistoryResource,
    ])
      authz.ui.place(authz.compositeResources.define(resource), {
        section: 'group-erp.materials',
      });
  }
}

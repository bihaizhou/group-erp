import type { Application } from '@nocobase/app-server/application';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import { ServiceProvider } from '@nocobase/service-provider';
import {
  ProductionService,
  productionServiceToken,
} from './production-service.js';

export default class ProductionProvider extends ServiceProvider<Application> {
  public readonly name = 'group-erp/production';

  public override register() {
    this.app.container.singleton(productionServiceToken, () => {
      return new ProductionService(
        this.app.container.resolve(databaseManagerToken),
        this.app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai',
      );
    });
  }

  public override async boot() {
    const authz = this.app.container.resolve(authorizationToken);
    authz.database.collections.add({
      name: 'prdAttendanceRecords',
      title: { key: 'production.data', ns: 'group-erp' },
    });
    authz.database.collections.add({
      name: 'prdUnitProfiles',
      title: { key: 'production.setupData', ns: 'group-erp' },
    });
    authz.database.collections.add({
      name: 'prdOutputMappings',
      title: { key: 'production.outputData', ns: 'group-erp' },
    });
    authz.database.collections.add({
      name: 'prdOvertimeRequests',
      title: { key: 'production.overtimeData', ns: 'group-erp' },
    });
    authz.database.collections.add({
      name: 'prdDowntimeEvents',
      title: { key: 'production.downtimeData', ns: 'group-erp' },
    });
    authz.database.collections.add({
      name: 'prdMaintenancePlans',
      title: { key: 'production.maintenancePlansData', ns: 'group-erp' },
    });
    authz.ui.sections.add({
      name: 'group-erp.production',
      title: { key: 'production.title', ns: 'group-erp' },
      parent: 'business',
    });
    authz.settings.add({
      id: 'production',
      title: { key: 'production.settings', ns: 'group-erp' },
      actions: [
        { name: 'read' },
        { name: 'manage' },
        { name: 'approve' },
        { name: 'readAll' },
      ],
    });
    authz.ui.place(
      { type: 'settings', id: 'production' },
      { section: 'group-erp.production' },
    );
  }
}

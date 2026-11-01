import type { Application } from '@nocobase/app-server/application';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import { ServiceProvider } from '@nocobase/service-provider';
import {
  OperationsService,
  operationsServiceToken,
} from './operations-service.js';

export default class OperationsProvider extends ServiceProvider<Application> {
  public readonly name = 'group-erp/operations';

  public override register() {
    this.app.container.singleton(operationsServiceToken, () => {
      return new OperationsService(
        this.app.container.resolve(databaseManagerToken),
        this.app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai',
      );
    });
  }

  public override async boot() {
    const authz = this.app.container.resolve(authorizationToken);
    authz.ui.sections.add({
      name: 'group-erp.operations',
      title: { key: 'operations.title', ns: 'group-erp' },
      parent: 'business',
    });
    authz.settings.add({
      id: 'operations',
      title: { key: 'operations.settings', ns: 'group-erp' },
      actions: [{ name: 'read' }, { name: 'manage' }, { name: 'readAll' }],
    });
    authz.ui.place(
      { type: 'settings', id: 'operations' },
      { section: 'group-erp.operations' },
    );
  }
}

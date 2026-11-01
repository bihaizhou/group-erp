import type { Application } from '@nocobase/app-server/application';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import { ServiceProvider } from '@nocobase/service-provider';
import { HseService, hseServiceToken } from './hse-service.js';

const hseTables = [
  'hseIncidents',
  'hseHazards',
  'hseInspections',
  'hseWorkPermits',
  'hseCertificates',
  'hseTrainingRecords',
  'hseActions',
];

export default class HseProvider extends ServiceProvider<Application> {
  public readonly name = 'group-erp/hse';

  public override register() {
    this.app.container.singleton(hseServiceToken, () => {
      return new HseService(
        this.app.container.resolve(databaseManagerToken),
        this.app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai',
      );
    });
  }

  public override async boot() {
    const authz = this.app.container.resolve(authorizationToken);
    for (const name of hseTables)
      authz.database.collections.add({
        name,
        title: { key: 'hse.data', ns: 'group-erp' },
      });
    authz.ui.sections.add({
      name: 'group-erp.hse',
      title: { key: 'hse.title', ns: 'group-erp' },
      parent: 'business',
    });
    authz.settings.add({
      id: 'hse',
      title: { key: 'hse.settings', ns: 'group-erp' },
      actions: [
        { name: 'read' },
        { name: 'manage' },
        { name: 'approve' },
        { name: 'readAll' },
      ],
    });
    authz.ui.place(
      { type: 'settings', id: 'hse' },
      { section: 'group-erp.hse' },
    );
  }
}

import type { Application } from '@nocobase/app-server/application';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import { ServiceProvider } from '@nocobase/service-provider';
import { AssetService, assetServiceToken } from './asset-service.js';

export default class AssetsProvider extends ServiceProvider<Application> {
  public readonly name = 'group-erp/assets';

  public override register() {
    this.app.container.singleton(assetServiceToken, () => {
      return new AssetService(
        this.app.container.resolve(databaseManagerToken),
        this.app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai',
      );
    });
  }

  public override async boot() {
    const authz = this.app.container.resolve(authorizationToken);
    for (const name of ['assets', 'assetEvents'])
      authz.database.collections.add({
        name,
        title: { key: 'assets.data', ns: 'group-erp' },
      });
    authz.ui.sections.add({
      name: 'group-erp.assets',
      title: { key: 'assets.title', ns: 'group-erp' },
      parent: 'business',
    });
    authz.settings.add({
      id: 'assets',
      title: { key: 'assets.settings', ns: 'group-erp' },
      actions: [{ name: 'read' }, { name: 'manage' }, { name: 'readAll' }],
    });
    authz.ui.place(
      { type: 'settings', id: 'assets' },
      { section: 'group-erp.assets' },
    );
  }
}

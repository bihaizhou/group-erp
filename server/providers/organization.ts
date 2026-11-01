import type { Application } from '@nocobase/app-server/application';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import {
  ServiceProvider,
  createServiceToken,
} from '@nocobase/service-provider';
import { OrganizationService } from './organization-service.js';

export const organizationServiceToken = createServiceToken<OrganizationService>(
  'group-erp/organization',
);
export default class OrganizationProvider extends ServiceProvider<Application> {
  public readonly name = 'group-erp/organization';
  public override register(): void {
    this.app.container.singleton(
      organizationServiceToken,
      () =>
        new OrganizationService(
          this.app.container.resolve(databaseManagerToken),
          this.app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai',
        ),
    );
  }
  public override async boot(): Promise<void> {
    const authz = this.app.container.resolve(authorizationToken);
    authz.settings.add({
      id: 'organization',
      title: { key: 'org.title', ns: 'group-erp' },
      actions: [
        { name: 'read', title: { key: 'org.read', ns: 'group-erp' } },
        { name: 'update', title: { key: 'org.maintain', ns: 'group-erp' } },
      ],
    });
    authz.ui.sections.add({
      name: 'group-erp',
      title: { key: 'erp.title', ns: 'group-erp' },
      parent: 'administration',
    });
    authz.ui.place(
      { type: 'settings', id: 'organization' },
      { section: 'group-erp' },
    );
  }
}

import type { Application } from '@nocobase/app-server/application';
import { loggingToken } from '@nocobase/app-server/logging';
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
  private sweep: ReturnType<typeof setInterval> | undefined;
  private sweeping = false;
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
  public override async start(): Promise<void> {
    const database = this.app.container.resolve(databaseManagerToken);
    // An embedded app can boot before this migration exists; wait for the table
    // instead of turning the missing schema into a failed startup.
    if (!(await database.collections().get('orgPendingChanges'))) {
      this.app.container
        .resolve(loggingToken)
        .getLogger('organization')
        .warn(
          'Pending organization changes are not installed; the scheduler stays idle.',
        );
      return;
    }
    // Tests call applyDue() directly, so a live timer would only race their
    // assertions about the record staying unchanged before the manual sweep.
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
    const service = this.app.container.resolve(organizationServiceToken);
    const logger = this.app.container
      .resolve(loggingToken)
      .getLogger('organization');
    const tick = async () => {
      if (this.sweeping) return;
      this.sweeping = true;
      try {
        const failures = await service.applyDue();
        for (const failure of failures)
          logger.warn(
            failure,
            'Scheduled organization change could not be applied and was marked failed.',
          );
      } catch (error) {
        logger.error(
          { error },
          'Scheduled organization change sweep failed.',
        );
      } finally {
        this.sweeping = false;
      }
    };
    this.sweep = setInterval(() => void tick(), 30000);
    // Never keep the process (or a test runner) alive for the sweep.
    this.sweep.unref?.();
  }
  public override async shutdown(): Promise<void> {
    if (this.sweep) {
      clearInterval(this.sweep);
      this.sweep = undefined;
    }
  }
}

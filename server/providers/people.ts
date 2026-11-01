import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import type { Application } from '@nocobase/app-server/application';
import { jobExecutorServiceToken } from '@nocobase/app-server/jobs';
import { loggingToken } from '@nocobase/app-server/logging';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import {
  LIFECYCLE_PARAMETER_COLLECTIONS,
  LifecycleRuntime,
  createRepositoryLifecycleStore,
} from '@nocobase/lifecycle';
import {
  createLifecycleJobs,
  type LifecycleJobs,
} from '@nocobase/lifecycle/jobs';
import {
  ServiceProvider,
  createServiceToken,
} from '@nocobase/service-provider';
import { PeopleService } from './people-service.js';
import { peopleTables } from './people-model.js';
import { recordLifecycleToken } from './record-lifecycle.js';
import {
  peopleResources,
  companyAccess,
  ownCompanyAccess,
  peopleAuditResource,
  orgReadColumns,
} from './people-resources.js';

export const peopleServiceToken =
  createServiceToken<PeopleService>('group-erp/people');
export default class PeopleProvider extends ServiceProvider<Application> {
  public readonly name = 'group-erp/people';
  private jobs: LifecycleJobs | undefined;
  public override register() {
    this.app.container.singleton(recordLifecycleToken, () => {
      const db = this.app.container.resolve(databaseManagerToken);
      const executors = this.app.container.resolve(jobExecutorServiceToken);
      const logger = this.app.container
        .resolve(loggingToken)
        .getLogger('people');
      this.jobs = createLifecycleJobs({
        jobs: executors.getJobExecutor('group-erp'),
        schedule: executors.getScheduleExecutor('group-erp'),
        jobName: 'group-erp/people-lifecycle-effect',
        sweepEveryMs: 30000,
        onSweep: async () => {
          const service = this.app.container.resolve(peopleServiceToken);
          const failures = await service.applyDue();
          for (const failure of failures)
            logger.warn(
              failure,
              'Scheduled personnel change remains approved and will retry.',
            );
          await service.runtime.prune({
            olderThan: new Date(Date.now() - 7 * 86400000),
          });
        },
      });
      return new LifecycleRuntime({
        store: createRepositoryLifecycleStore(db),
        dispatcher: this.jobs,
        logger: {
          warn: (message, details) => logger.warn({ details }, message),
          error: (message, details) => logger.error({ details }, message),
        },
      });
    });
    this.app.container.singleton(peopleServiceToken, () => {
      return new PeopleService(
        this.app.container.resolve(databaseManagerToken),
        this.app.container.resolve(recordLifecycleToken),
        this.app.container.resolve(userAdministrationServiceToken),
        this.app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai',
        this.app.container.resolve(authorizationToken).permissionSets,
      );
    });
  }
  public override async boot() {
    const authz = this.app.container.resolve(authorizationToken);
    for (const name of [
      ...Object.values(peopleTables),
      'peopleAudit',
      'peopleApprovalTasks',
      ...Object.values(LIFECYCLE_PARAMETER_COLLECTIONS),
      ...Object.keys(orgReadColumns),
    ])
      authz.database.collections.add({
        name,
        title: { key: `people.${name}`, ns: 'group-erp' },
      });
    authz.recordAccess.define(companyAccess);
    authz.recordAccess.define(
      ownCompanyAccess(
        this.app.container.resolve(databaseManagerToken),
        this.app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai',
      ),
    );
    authz.ui.sections.add({
      name: 'group-erp.people',
      title: { key: 'people.title', ns: 'group-erp' },
      parent: 'business',
    });
    for (const resource of [
      ...Object.values(peopleResources),
      peopleAuditResource,
    ])
      authz.ui.place(authz.compositeResources.define(resource), {
        section: 'group-erp.people',
      });
    authz.settings.add({
      id: 'personnel.accountBinding',
      title: { key: 'people.accountBinding', ns: 'group-erp' },
      actions: [{ name: 'read' }, { name: 'update' }],
    });
    authz.ui.place(
      { type: 'settings', id: 'personnel.accountBinding' },
      { section: 'group-erp' },
    );
    authz.settings.add({
      id: 'personnel.sensitive',
      title: { key: 'people.sensitive', ns: 'group-erp' },
      actions: [{ name: 'read' }, { name: 'update' }],
    });
    authz.ui.place(
      { type: 'settings', id: 'personnel.sensitive' },
      { section: 'group-erp' },
    );
  }
  public override async start() {
    const database = this.app.container.resolve(databaseManagerToken);
    // The effect-run ledger arrives with the people migration. An embedded app
    // can boot before that schema exists; the sweeper must wait for it instead of
    // turning a missing migration into a failed startup.
    if (!(await database.collections().get('lifecycleEffectRuns'))) {
      this.app.container
        .resolve(loggingToken)
        .getLogger('people')
        .warn(
          'Lifecycle effect runs are not installed; personnel effects stay idle.',
        );
      return;
    }
    await this.jobs?.start(
      this.app.container.resolve(peopleServiceToken).runtime,
    );
  }
  public override async shutdown() {
    await this.jobs?.shutdown();
  }
}

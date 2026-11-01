import type { Application } from '@nocobase/app-server/application';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { databaseManagerToken } from '@nocobase/db';
import {
  ServiceProvider,
  createServiceToken,
} from '@nocobase/service-provider';
import { IssuePurposeService } from './issue-purpose-service.js';
import { IssueRequestService } from './issue-request-service.js';
import { recordLifecycleToken } from './record-lifecycle.js';
import { supplyChainMaterialServiceToken } from './supply-chain.js';
import {
  issueResource,
  issueSettingsResource,
  issuePurposeResource,
  issueCompanyAccess,
  issueOwnAccess,
  issueOwnCompanyAccess,
} from './issue-request-resources.js';
export const issuePurposeServiceToken = createServiceToken<IssuePurposeService>(
  'group-erp/issue-purposes',
);
export const issueRequestServiceToken = createServiceToken<IssueRequestService>(
  'group-erp/issue-requests',
);
export default class RequisitionsProvider extends ServiceProvider<Application> {
  readonly name = 'group-erp/requisitions';
  override register() {
    this.app.container.singleton(
      issuePurposeServiceToken,
      () =>
        new IssuePurposeService(
          this.app.container.resolve(databaseManagerToken),
          this.app.container.resolve(recordLifecycleToken),
        ),
    );
    this.app.container.singleton(
      issueRequestServiceToken,
      () =>
        new IssueRequestService(
          this.app.container.resolve(databaseManagerToken),
          this.app.container.resolve(recordLifecycleToken),
          this.app.container.resolve(issuePurposeServiceToken),
          this.app.container.resolve(supplyChainMaterialServiceToken),
          this.app.container.resolve(userAdministrationServiceToken),
          this.app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai',
        ),
    );
  }
  override async boot() {
    const authz = this.app.container.resolve(authorizationToken);
    for (const name of [
      'materialIssuePurposes',
      'materialIssueRequests',
      'materialIssueRequestLines',
      'supplyChainRequestVersions',
      'supplyChainReviewTasks',
    ])
      authz.database.collections.add({
        name,
        title: { key: 'requisitions.issue.title', ns: 'group-erp' },
      });
    authz.recordAccess.define(issueCompanyAccess);
    authz.recordAccess.define(issueOwnAccess);
    authz.recordAccess.define(
      issueOwnCompanyAccess(
        this.app.container.resolve(databaseManagerToken),
        this.app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai',
      ),
    );
    authz.ui.sections.add({
      name: 'group-erp.requisitions',
      title: { key: 'requisitions.title', ns: 'group-erp' },
      parent: 'business',
    });
    for (const resource of [
      issueResource,
      issueSettingsResource,
      issuePurposeResource,
    ])
      authz.ui.place(authz.compositeResources.define(resource), {
        section: 'group-erp.requisitions',
      });
  }
}

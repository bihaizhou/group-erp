import { defineSeed, type SeedContext } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';

/**
 * The business administrator: every business page and every business action.
 *
 * The platform `root` set is an unrestricted superuser declared in code, so it
 * is invisible in the role editor. This is its app-owned, visible counterpart:
 * the account that runs the business can be handed a role whose grants name
 * exactly the pages and resources it may use.
 *
 * Record scope is deliberately left unset. The role editor renders that as
 * 不限制 and the authorizer expands a composite grant without a policy into
 * its resources without a record filter, which is what "all business
 * permissions" means here.
 *
 * Permission management stays with `system-administrator`: this set carries no
 * `settings:authorization.*` grant, so it cannot edit grants or default access.
 */
const KEY = 'administrator';
const TITLE = '管理员';
const DEFAULT_INITIAL_ADMIN = 'nocobase';

const GRANTS = [
  { resource: { type: 'page', id: 'organization-overview' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'organization-subjects' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'organization-units' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'organization-positions' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'organization-sectors' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'organization-regions' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'organization-relations' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'position-permissions' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'organization-history' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'people-overview' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'people-profiles' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'people-dimensions' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'people-models' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'people-evaluations' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'people-developmentPlans' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'people-workforcePlans' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'people-history' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'operations-overview' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'operations-issues' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'operations-targets' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'materials-overview' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-materials' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-material-requests' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-material-names' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-material-templates' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-material-units' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-material-unitRules' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-material-references' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-material-tags' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-material-tagLinks' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-material-history' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-overview' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-inbounds' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-outbounds' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-transfers' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-counts' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-inventory' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-review-settings' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'warehouse-material-warehouses' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'procurement-overview' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'procurement-requests' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'procurement-orders' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'procurement-suppliers' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'procurement-review-settings' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'requisitions-overview' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'requisitions-requests' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'requisitions-purposes' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'requisitions-review-settings' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'sales-overview' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'sales-price-lists' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'sales-receivables' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'sales-customers' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'sales-orders' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'sales-review-settings' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'people-personnel-overview' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'people-employees' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'people-employments' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'people-assignments' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'people-changes' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'people-approval-settings' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'people-approvals' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'production-overview' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'production-report' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'production-schedules' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'production-shift-reports' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'production-equipment' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'production-maintenance-plans' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'production-downtime' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'production-overtime' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'production-setup' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'people-assets' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'hse-overview' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'hse-incidents' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'hse-hazards' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'hse-certificates' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'hse-inspections' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'hse-work-permits' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'hse-training-records' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'hse-actions' }, actions: [{ action: 'access' }] },
  { resource: { type: 'page', id: 'finance-overview' }, actions: [{ action: 'access' }] },
  { resource: { type: 'composite', id: 'people.employees' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'people.employments' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'people.assignments' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'people.changes' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'people.dimensions' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'people.models' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'people.profiles' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'people.evaluations' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'people.developmentPlans' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'people.workforcePlans' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }, { action: 'companyConfirm' }] },
  { resource: { type: 'composite', id: 'people.history' }, actions: [{ action: 'read' }] },
  { resource: { type: 'composite', id: 'materials.names' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'materials.templates' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'materials.skus' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'materials.units' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'materials.unitRules' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'materials.references' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'materials.tags' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'materials.tagLinks' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'materials.requests' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'materials.warehouses' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'review' }] },
  { resource: { type: 'composite', id: 'materials.catalog' }, actions: [{ action: 'read' }] },
  { resource: { type: 'composite', id: 'materials.history' }, actions: [{ action: 'read' }] },
  { resource: { type: 'composite', id: 'materials.sources' }, actions: [{ action: 'read' }, { action: 'resolve' }] },
  { resource: { type: 'composite', id: 'procurement.materials' }, actions: [{ action: 'read' }] },
  { resource: { type: 'composite', id: 'requisitions.materials' }, actions: [{ action: 'read' }] },
  { resource: { type: 'composite', id: 'procurement.suppliers' }, actions: [{ action: 'read' }, { action: 'create' }, { action: 'updateRelationship' }, { action: 'updateIdentity' }, { action: 'linkIdentity' }, { action: 'configureApplicability' }, { action: 'addRole' }] },
  { resource: { type: 'composite', id: 'procurement.requests' }, actions: [{ action: 'read' }, { action: 'readAll' }, { action: 'create' }, { action: 'update' }, { action: 'submit' }, { action: 'review' }, { action: 'withdraw' }, { action: 'revise' }, { action: 'cancel' }, { action: 'reassign' }, { action: 'delegate' }, { action: 'requestGovernance' }, { action: 'confirmMaterial' }, { action: 'rejectMaterial' }, { action: 'takeOverSource' }, { action: 'merge' }] },
  { resource: { type: 'composite', id: 'procurement.settings' }, actions: [{ action: 'read' }, { action: 'update' }] },
  { resource: { type: 'composite', id: 'procurement.orders' }, actions: [{ action: 'read' }, { action: 'create' }, { action: 'update' }, { action: 'submit' }, { action: 'review' }, { action: 'withdraw' }, { action: 'revise' }, { action: 'cancel' }, { action: 'reassign' }, { action: 'copy' }, { action: 'closeRemainder' }] },
  { resource: { type: 'composite', id: 'requisitions.requests' }, actions: [{ action: 'read' }, { action: 'create' }, { action: 'update' }, { action: 'submit' }, { action: 'review' }, { action: 'withdraw' }, { action: 'revise' }, { action: 'cancel' }, { action: 'reassign' }, { action: 'delegate' }, { action: 'requestGovernance' }, { action: 'confirmMaterial' }, { action: 'rejectMaterial' }, { action: 'takeOverSource' }] },
  { resource: { type: 'composite', id: 'requisitions.settings' }, actions: [{ action: 'read' }, { action: 'update' }] },
  { resource: { type: 'composite', id: 'requisitions.purposes' }, actions: [{ action: 'read' }, { action: 'create' }, { action: 'update' }, { action: 'activate' }, { action: 'deactivate' }] },
  { resource: { type: 'composite', id: 'sales.orders' }, actions: [{ action: 'read' }, { action: 'create' }, { action: 'update' }, { action: 'submit' }, { action: 'review' }, { action: 'withdraw' }, { action: 'revise' }, { action: 'cancel' }, { action: 'reassign' }, { action: 'copy' }, { action: 'closeRemainder' }] },
  { resource: { type: 'composite', id: 'sales.customers' }, actions: [{ action: 'read' }, { action: 'create' }, { action: 'updateRelationship' }, { action: 'updateIdentity' }, { action: 'linkIdentity' }, { action: 'configureApplicability' }, { action: 'addRole' }] },
  { resource: { type: 'composite', id: 'warehouse.documents' }, actions: [{ action: 'read' }, { action: 'create' }, { action: 'update' }, { action: 'submit' }, { action: 'review' }, { action: 'withdraw' }, { action: 'revise' }, { action: 'cancel' }, { action: 'reassign' }, { action: 'copy' }, { action: 'post' }, { action: 'initial' }, { action: 'loss' }, { action: 'productionReceipt' }, { action: 'productionIssue' }, { action: 'quality' }, { action: 'reverse' }] },
  { resource: { type: 'composite', id: 'warehouse.transfers' }, actions: [{ action: 'read' }, { action: 'create' }, { action: 'update' }, { action: 'submit' }, { action: 'review' }, { action: 'withdraw' }, { action: 'revise' }, { action: 'cancel' }, { action: 'reassign' }, { action: 'copy' }, { action: 'dispatch' }, { action: 'receive' }, { action: 'discrepancy' }] },
  { resource: { type: 'composite', id: 'warehouse.counts' }, actions: [{ action: 'read' }, { action: 'create' }, { action: 'update' }, { action: 'submit' }, { action: 'review' }, { action: 'withdraw' }, { action: 'cancel' }, { action: 'reassign' }, { action: 'copy' }, { action: 'start' }] },
  { resource: { type: 'composite', id: 'warehouse.inventory' }, actions: [{ action: 'read' }, { action: 'reserve' }, { action: 'release' }, { action: 'reconcile' }] },
  { resource: { type: 'composite', id: 'warehouse.settings' }, actions: [{ action: 'read' }, { action: 'update' }] },
  { resource: { type: 'settings', id: 'hse' }, actions: [{ action: 'read' }, { action: 'manage' }, { action: 'approve' }, { action: 'readAll' }, { action: 'report' }] },
  { resource: { type: 'settings', id: 'production' }, actions: [{ action: 'read' }, { action: 'manage' }, { action: 'approve' }, { action: 'readAll' }] },
  { resource: { type: 'settings', id: 'operations' }, actions: [{ action: 'read' }, { action: 'manage' }, { action: 'readAll' }] },
  { resource: { type: 'settings', id: 'assets' }, actions: [{ action: 'read' }, { action: 'manage' }, { action: 'readAll' }, { action: 'approve' }] },
  { resource: { type: 'settings', id: 'organization' }, actions: [{ action: 'read' }, { action: 'update' }, { action: 'approve' }] },
  { resource: { type: 'settings', id: 'personnel.accountBinding' }, actions: [{ action: 'read' }, { action: 'update' }] },
  { resource: { type: 'settings', id: 'personnel.sensitive' }, actions: [{ action: 'read' }, { action: 'update' }] },
];

export default defineSeed({
  name: '202611180002_administrator_role',
  transaction: true,
  async run({ config, repository, query }: SeedContext) {
    const existing = await repository('authorizationPermissionSets').findOne({
      filter: { key: KEY },
    });
    if (!existing) {
      const now = new Date();
      await repository('authorizationPermissionSets').createOne({
        values: {
          id: KEY,
          key: KEY,
          title: encodeAuthorizationTitle(TITLE),
          grants: GRANTS,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    // Resolve the account the same way the platform root-set seed does, so the
    // default administrator of any installation (`nocobase`, `admin`, ...)
    // gets the business role too.
    const configured = config.get<string>('users.initialAdmin.username');
    const username = String(configured ?? DEFAULT_INITIAL_ADMIN)
      .trim()
      .toLowerCase();
    const admin = await query
      .selectFrom('user')
      .select('id')
      .where('username', '=', username)
      .limit(1)
      .executeTakeFirst();
    if (!admin) return;
    const userId = String(admin.id);
    const assignmentId = `user:${userId}:${KEY}`;
    const assigned = await repository(
      'authorizationPermissionSetAssignments',
    ).findOne({ filter: { id: assignmentId } });
    if (assigned) return;
    const now = new Date();
    await query
      .insertInto('authorizationPermissionSetAssignments')
      .values({
        id: assignmentId,
        subjectType: 'user',
        subjectId: userId,
        permissionSetKey: KEY,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  },
});

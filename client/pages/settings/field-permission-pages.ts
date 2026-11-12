/**
 * Field-level permissions belong to the page that renders the fields. The field
 * catalog is keyed by data resource, so this map is the one place that connects
 * a page permission id to the resources shown on it.
 *
 * Every page has fields: dashboards list their metrics, read-only listings
 * their columns. Keep this in sync with `server/providers/field-catalog.ts` —
 * a page added without a catalog resource shows no fields here, and a page
 * missing from this map loses its field entry point.
 */
export const pageFieldResources: Readonly<Record<string, readonly string[]>> = {
  // 生产
  'production-overview': ['production.overview'],
  'production-report': [
    'production.report.material',
    'production.report.shift',
    'production.report.attendance',
    'production.report.downtime',
    'production.report.maintenance',
    'production.report.overtime',
  ],
  'production-schedules': ['production.schedule'],
  'production-shift-reports': ['production.shiftReport'],
  'production-equipment': ['production.equipment'],
  'production-maintenance-plans': ['production.plan'],
  'production-downtime': ['production.downtime'],
  'production-overtime': ['production.overtime'],
  'production-setup': ['production.setupUnit', 'production.setupMaterial'],
  // HSE
  'hse-overview': ['hse.overview'],
  'hse-incidents': ['hse.incident'],
  'hse-hazards': ['hse.hazard'],
  'hse-certificates': ['hse.certificate'],
  // 运营
  'operations-overview': ['operations.overview'],
  'operations-issues': ['operations.issue'],
  'operations-targets': ['operations.target'],
  // 人员
  'people-overview': ['people.overview'],
  'people-personnel-overview': ['people.personnelOverview'],
  'people-history': ['people.history'],
  'people-approvals': ['people.approvals'],
  'people-approval-settings': ['people.approvalSettings'],
  'people-assets': ['people.assets'],
  'people-employees': [
    'people.employee',
    'people.employee.contact',
    'people.employee.grade',
  ],
  'people-employments': ['people.employment'],
  'people-assignments': ['people.assignment'],
  'people-changes': ['people.change'],
  'people-dimensions': ['people.dimension'],
  'people-models': ['people.model'],
  'people-profiles': [
    'people.profile',
    'people.employee.contact',
    'people.employee.grade',
  ],
  'people-evaluations': ['people.evaluation'],
  'people-developmentPlans': ['people.developmentPlan'],
  'people-workforcePlans': ['people.workforcePlan'],
  // 物料
  'materials-overview': ['materials.overview'],
  'warehouse-materials': ['materials.sku'],
  'warehouse-material-names': ['materials.name'],
  'warehouse-material-templates': ['materials.template'],
  'warehouse-material-units': ['materials.unit'],
  'warehouse-material-unitRules': ['materials.unitRule'],
  'warehouse-material-references': ['materials.reference'],
  'warehouse-material-tags': ['materials.tag'],
  'warehouse-material-tagLinks': ['materials.tagLink'],
  'warehouse-material-requests': ['materials.request'],
  'warehouse-material-subjectSettings': ['materials.subjectSetting'],
  'warehouse-material-warehouses': ['materials.warehouse'],
  'warehouse-material-history': ['materials.history'],
  // 销售
  'sales-overview': ['sales.overview'],
  'sales-customers': ['sales.customer'],
  'sales-orders': ['execution.document', 'execution.document.line'],
  // 仓库
  'warehouse-overview': ['warehouse.overview'],
  'warehouse-inbounds': ['execution.document', 'execution.document.line'],
  'warehouse-outbounds': ['execution.document', 'execution.document.line'],
  'warehouse-transfers': ['execution.document', 'execution.document.line'],
  'warehouse-counts': ['execution.document', 'execution.document.line'],
  'warehouse-inventory': ['warehouse.inventory.balance'],
  // 采购
  'procurement-overview': ['procurement.overview'],
  'procurement-orders': ['execution.document', 'execution.document.line'],
  'procurement-requests': ['purchase.request', 'purchase.request.line'],
  'procurement-suppliers': [
    'procurement.supplier.identity',
    'procurement.supplier.base',
  ],
  // 领用
  'requisitions-overview': ['requisitions.overview'],
  'requisitions-purposes': ['issue.purpose'],
  'requisitions-requests': ['issue.request', 'issue.request.line'],
  // 审批设置
  'sales-review-settings': ['review.sales'],
  'warehouse-review-settings': ['review.warehouse'],
  'procurement-review-settings': ['review.procurement'],
  'requisitions-review-settings': ['review.requisitions'],
  // 组织
  'position-permissions': ['organization.positionPermissions'],
};

/** Resource ids shown on a page; empty when the page has no field controls. */
export function fieldResourcesForPage(
  pageId: string | undefined,
): readonly string[] {
  return pageId ? (pageFieldResources[pageId] ?? []) : [];
}

/** Every page that renders one field resource, in page-flow order. */
export function pagesForFieldResource(resourceId: string): readonly string[] {
  return Object.entries(pageFieldResources)
    .filter(([, resources]) => resources.includes(resourceId))
    .map(([pageId]) => pageId);
}

/**
 * Page-access rows are stored as JSON `["page", "<page id>", "access"]`.
 * Reading the id back lets the permission editor attach a page-scoped action
 * without changing the stored navigation projection or its tests.
 */
export function pageIdFromPermissionRow(
  rowId: string | undefined,
): string | undefined {
  if (!rowId) return undefined;
  try {
    const value: unknown = JSON.parse(rowId);
    if (!Array.isArray(value) || value.length < 3) return undefined;
    const type: unknown = value[0];
    const id: unknown = value[1];
    const action: unknown = value[2];
    return type === 'page' && action === 'access' && typeof id === 'string'
      ? id
      : undefined;
  } catch {
    return undefined;
  }
}

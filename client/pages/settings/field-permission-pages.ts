/**
 * Field-level permissions belong to the page that renders the fields. The field
 * catalog is keyed by data resource, so this map is the one place that connects
 * a page permission id to the resources shown on it.
 *
 * Keep it next to the page-permission projection: a page renamed or removed
 * without updating this map loses its field entry point, which is visible in
 * the role editor rather than failing silently at runtime.
 */
export const pageFieldResources: Readonly<Record<string, readonly string[]>> = {
  'production-report': [
    'production.report.material',
    'production.report.shift',
    'production.report.attendance',
    'production.report.downtime',
    'production.report.maintenance',
    'production.report.overtime',
  ],
  'procurement-suppliers': ['procurement.supplier.identity'],
  'procurement-orders': ['execution.document.line'],
  'sales-orders': ['execution.document.line'],
  'warehouse-inbounds': ['execution.document.line'],
  'warehouse-outbounds': ['execution.document.line'],
  'warehouse-transfers': ['execution.document.line'],
  'warehouse-counts': ['execution.document.line'],
  'people-employees': ['people.employee.contact', 'people.employee.grade'],
  'people-profiles': ['people.employee.contact', 'people.employee.grade'],
  'warehouse-inventory': ['warehouse.inventory.balance'],
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

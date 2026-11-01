import type { PagePermissionTitles } from './page-permissions.js';

/** Permission labels for application pages without navigation/breadcrumb titles (including overlays).
 * Keys are existing route names; values are application translation keys.
 * Do not add navigation/breadcrumbs or change authorization ids just to name a permission.
 */
export const pagePermissionTitles: PagePermissionTitles = {
  'people-profiles-new': 'pageTitles.people-profiles-new',
  'people-profiles-edit': 'pageTitles.people-profiles-edit',
  'people-profiles-detail': 'pageTitles.people-profiles-detail',
  'people-profiles-detail-edit': 'pageTitles.people-profiles-detail-edit',
  'people-profiles-detail-action': 'pageTitles.people-profiles-detail-action',
  'people-profiles-evaluation': 'pageTitles.people-profiles-evaluation',
  'people-profiles-evaluation-edit':
    'pageTitles.people-profiles-evaluation-edit',
  'people-profiles-evaluation-action':
    'pageTitles.people-profiles-evaluation-action',
  'people-profiles-development': 'pageTitles.people-profiles-development',
  'people-profiles-development-edit':
    'pageTitles.people-profiles-development-edit',
  'people-profiles-development-action':
    'pageTitles.people-profiles-development-action',
  'people-dimensions-new': 'pageTitles.people-dimensions-new',
  'people-dimensions-edit': 'pageTitles.people-dimensions-edit',
  'people-dimensions-detail': 'pageTitles.people-dimensions-detail',
  'people-dimensions-detail-edit': 'pageTitles.people-dimensions-detail-edit',
  'people-dimensions-detail-action':
    'pageTitles.people-dimensions-detail-action',
  'people-models-new': 'pageTitles.people-models-new',
  'people-models-edit': 'pageTitles.people-models-edit',
  'people-models-detail': 'pageTitles.people-models-detail',
  'people-models-detail-edit': 'pageTitles.people-models-detail-edit',
  'people-models-detail-action': 'pageTitles.people-models-detail-action',
  'people-evaluations-new': 'pageTitles.people-evaluations-new',
  'people-evaluations-edit': 'pageTitles.people-evaluations-edit',
  'people-evaluations-detail': 'pageTitles.people-evaluations-detail',
  'people-evaluations-detail-edit': 'pageTitles.people-evaluations-detail-edit',
  'people-evaluations-detail-action':
    'pageTitles.people-evaluations-detail-action',
  'people-developmentPlans-new': 'pageTitles.people-developmentPlans-new',
  'people-developmentPlans-edit': 'pageTitles.people-developmentPlans-edit',
  'people-developmentPlans-detail': 'pageTitles.people-developmentPlans-detail',
  'people-developmentPlans-detail-edit':
    'pageTitles.people-developmentPlans-detail-edit',
  'people-developmentPlans-detail-action':
    'pageTitles.people-developmentPlans-detail-action',
  'people-workforcePlans-new': 'pageTitles.people-workforcePlans-new',
  'people-workforcePlans-edit': 'pageTitles.people-workforcePlans-edit',
  'people-workforcePlans-detail': 'pageTitles.people-workforcePlans-detail',
  'people-workforcePlans-detail-edit':
    'pageTitles.people-workforcePlans-detail-edit',
  'people-workforcePlans-detail-action':
    'pageTitles.people-workforcePlans-detail-action',
  'people-history': 'pageTitles.people-history',
  'warehouse-materials-request-material':
    'pageTitles.warehouse-materials-request-material',
  'warehouse-materials-new': 'pageTitles.warehouse-materials-new',
  'warehouse-materials-edit': 'pageTitles.warehouse-materials-edit',
  'warehouse-materials-detail': 'pageTitles.warehouse-materials-detail',
  'warehouse-materials-detail-edit':
    'pageTitles.warehouse-materials-detail-edit',
  'warehouse-materials-action': 'pageTitles.warehouse-materials-action',
  'warehouse-material-names-new': 'pageTitles.warehouse-material-names-new',
  'warehouse-material-names-edit': 'pageTitles.warehouse-material-names-edit',
  'warehouse-material-names-detail':
    'pageTitles.warehouse-material-names-detail',
  'warehouse-material-names-detail-edit':
    'pageTitles.warehouse-material-names-detail-edit',
  'warehouse-material-names-action':
    'pageTitles.warehouse-material-names-action',
  'warehouse-material-templates-new':
    'pageTitles.warehouse-material-templates-new',
  'warehouse-material-templates-edit':
    'pageTitles.warehouse-material-templates-edit',
  'warehouse-material-templates-detail':
    'pageTitles.warehouse-material-templates-detail',
  'warehouse-material-templates-detail-edit':
    'pageTitles.warehouse-material-templates-detail-edit',
  'warehouse-material-templates-action':
    'pageTitles.warehouse-material-templates-action',
  'warehouse-material-units-new': 'pageTitles.warehouse-material-units-new',
  'warehouse-material-units-edit': 'pageTitles.warehouse-material-units-edit',
  'warehouse-material-units-detail':
    'pageTitles.warehouse-material-units-detail',
  'warehouse-material-units-detail-edit':
    'pageTitles.warehouse-material-units-detail-edit',
  'warehouse-material-units-action':
    'pageTitles.warehouse-material-units-action',
  'warehouse-material-unitRules-new':
    'pageTitles.warehouse-material-unitRules-new',
  'warehouse-material-unitRules-edit':
    'pageTitles.warehouse-material-unitRules-edit',
  'warehouse-material-unitRules-detail':
    'pageTitles.warehouse-material-unitRules-detail',
  'warehouse-material-unitRules-detail-edit':
    'pageTitles.warehouse-material-unitRules-detail-edit',
  'warehouse-material-unitRules-action':
    'pageTitles.warehouse-material-unitRules-action',
  'warehouse-material-references-new':
    'pageTitles.warehouse-material-references-new',
  'warehouse-material-references-edit':
    'pageTitles.warehouse-material-references-edit',
  'warehouse-material-references-detail':
    'pageTitles.warehouse-material-references-detail',
  'warehouse-material-references-detail-edit':
    'pageTitles.warehouse-material-references-detail-edit',
  'warehouse-material-references-action':
    'pageTitles.warehouse-material-references-action',
  'warehouse-material-tags-new': 'pageTitles.warehouse-material-tags-new',
  'warehouse-material-tags-edit': 'pageTitles.warehouse-material-tags-edit',
  'warehouse-material-tags-detail': 'pageTitles.warehouse-material-tags-detail',
  'warehouse-material-tags-detail-edit':
    'pageTitles.warehouse-material-tags-detail-edit',
  'warehouse-material-tags-action': 'pageTitles.warehouse-material-tags-action',
  'warehouse-material-tagLinks-new':
    'pageTitles.warehouse-material-tagLinks-new',
  'warehouse-material-tagLinks-edit':
    'pageTitles.warehouse-material-tagLinks-edit',
  'warehouse-material-tagLinks-detail':
    'pageTitles.warehouse-material-tagLinks-detail',
  'warehouse-material-tagLinks-detail-edit':
    'pageTitles.warehouse-material-tagLinks-detail-edit',
  'warehouse-material-tagLinks-action':
    'pageTitles.warehouse-material-tagLinks-action',
  'warehouse-material-requests-new':
    'pageTitles.warehouse-material-requests-new',
  'warehouse-material-requests-edit':
    'pageTitles.warehouse-material-requests-edit',
  'warehouse-material-requests-detail':
    'pageTitles.warehouse-material-requests-detail',
  'warehouse-material-requests-detail-edit':
    'pageTitles.warehouse-material-requests-detail-edit',
  'warehouse-material-requests-action':
    'pageTitles.warehouse-material-requests-action',
  'warehouse-material-requests-new-sku':
    'pageTitles.warehouse-material-requests-new-sku',
  'warehouse-material-requests-linked-sku':
    'pageTitles.warehouse-material-requests-linked-sku',
  'warehouse-material-requests-linked-sku-edit':
    'pageTitles.warehouse-material-requests-linked-sku-edit',
  'warehouse-material-requests-linked-sku-action':
    'pageTitles.warehouse-material-requests-linked-sku-action',
  'warehouse-material-subjectSettings-new':
    'pageTitles.warehouse-material-subjectSettings-new',
  'warehouse-material-subjectSettings-edit':
    'pageTitles.warehouse-material-subjectSettings-edit',
  'warehouse-material-subjectSettings-detail':
    'pageTitles.warehouse-material-subjectSettings-detail',
  'warehouse-material-subjectSettings-detail-edit':
    'pageTitles.warehouse-material-subjectSettings-detail-edit',
  'warehouse-material-subjectSettings-action':
    'pageTitles.warehouse-material-subjectSettings-action',
  'warehouse-material-history': 'pageTitles.warehouse-material-history',
  'warehouse-inbounds-new': 'pageTitles.warehouse-inbounds-new',
  'warehouse-inbounds-list-edit': 'pageTitles.warehouse-inbounds-list-edit',
  'warehouse-inbounds-detail': 'pageTitles.warehouse-inbounds-detail',
  'warehouse-inbounds-edit': 'pageTitles.warehouse-inbounds-edit',
  'warehouse-inbounds-copy': 'pageTitles.warehouse-inbounds-copy',
  'warehouse-inbounds-action': 'pageTitles.warehouse-inbounds-action',
  'warehouse-inbounds-version': 'pageTitles.warehouse-inbounds-version',
  'warehouse-inbounds-related': 'pageTitles.warehouse-inbounds-related',
  'warehouse-inbounds-receipts-new':
    'pageTitles.warehouse-inbounds-receipts-new',
  'warehouse-inbounds-shipments-new':
    'pageTitles.warehouse-inbounds-shipments-new',
  'warehouse-inbounds-dispatch-new':
    'pageTitles.warehouse-inbounds-dispatch-new',
  'warehouse-inbounds-receive-new': 'pageTitles.warehouse-inbounds-receive-new',
  'warehouse-inbounds-discrepancy-new':
    'pageTitles.warehouse-inbounds-discrepancy-new',
  'warehouse-inbounds-reversal-new':
    'pageTitles.warehouse-inbounds-reversal-new',
  'warehouse-inbounds-returns-new': 'pageTitles.warehouse-inbounds-returns-new',
  'warehouse-inbounds-execution-document':
    'pageTitles.warehouse-inbounds-execution-document',
  'warehouse-inbounds-execution-document-edit':
    'pageTitles.warehouse-inbounds-execution-document-edit',
  'warehouse-inbounds-execution-document-action':
    'pageTitles.warehouse-inbounds-execution-document-action',
  'warehouse-inbounds-execution-document-version':
    'pageTitles.warehouse-inbounds-execution-document-version',
  'warehouse-inbounds-execution-document-source':
    'pageTitles.warehouse-inbounds-execution-document-source',
  'warehouse-inbounds-execution-document-reversal':
    'pageTitles.warehouse-inbounds-execution-document-reversal',
  'warehouse-inbounds-execution-document-returns':
    'pageTitles.warehouse-inbounds-execution-document-returns',
  'warehouse-outbounds-new': 'pageTitles.warehouse-outbounds-new',
  'warehouse-outbounds-list-edit': 'pageTitles.warehouse-outbounds-list-edit',
  'warehouse-outbounds-detail': 'pageTitles.warehouse-outbounds-detail',
  'warehouse-outbounds-edit': 'pageTitles.warehouse-outbounds-edit',
  'warehouse-outbounds-copy': 'pageTitles.warehouse-outbounds-copy',
  'warehouse-outbounds-action': 'pageTitles.warehouse-outbounds-action',
  'warehouse-outbounds-version': 'pageTitles.warehouse-outbounds-version',
  'warehouse-outbounds-related': 'pageTitles.warehouse-outbounds-related',
  'warehouse-outbounds-receipts-new':
    'pageTitles.warehouse-outbounds-receipts-new',
  'warehouse-outbounds-shipments-new':
    'pageTitles.warehouse-outbounds-shipments-new',
  'warehouse-outbounds-dispatch-new':
    'pageTitles.warehouse-outbounds-dispatch-new',
  'warehouse-outbounds-receive-new':
    'pageTitles.warehouse-outbounds-receive-new',
  'warehouse-outbounds-discrepancy-new':
    'pageTitles.warehouse-outbounds-discrepancy-new',
  'warehouse-outbounds-reversal-new':
    'pageTitles.warehouse-outbounds-reversal-new',
  'warehouse-outbounds-returns-new':
    'pageTitles.warehouse-outbounds-returns-new',
  'warehouse-outbounds-execution-document':
    'pageTitles.warehouse-outbounds-execution-document',
  'warehouse-outbounds-execution-document-edit':
    'pageTitles.warehouse-outbounds-execution-document-edit',
  'warehouse-outbounds-execution-document-action':
    'pageTitles.warehouse-outbounds-execution-document-action',
  'warehouse-outbounds-execution-document-version':
    'pageTitles.warehouse-outbounds-execution-document-version',
  'warehouse-outbounds-execution-document-source':
    'pageTitles.warehouse-outbounds-execution-document-source',
  'warehouse-outbounds-execution-document-reversal':
    'pageTitles.warehouse-outbounds-execution-document-reversal',
  'warehouse-outbounds-execution-document-returns':
    'pageTitles.warehouse-outbounds-execution-document-returns',
  'warehouse-transfers-new': 'pageTitles.warehouse-transfers-new',
  'warehouse-transfers-list-edit': 'pageTitles.warehouse-transfers-list-edit',
  'warehouse-transfers-detail': 'pageTitles.warehouse-transfers-detail',
  'warehouse-transfers-edit': 'pageTitles.warehouse-transfers-edit',
  'warehouse-transfers-copy': 'pageTitles.warehouse-transfers-copy',
  'warehouse-transfers-action': 'pageTitles.warehouse-transfers-action',
  'warehouse-transfers-version': 'pageTitles.warehouse-transfers-version',
  'warehouse-transfers-related': 'pageTitles.warehouse-transfers-related',
  'warehouse-transfers-receipts-new':
    'pageTitles.warehouse-transfers-receipts-new',
  'warehouse-transfers-shipments-new':
    'pageTitles.warehouse-transfers-shipments-new',
  'warehouse-transfers-dispatch-new':
    'pageTitles.warehouse-transfers-dispatch-new',
  'warehouse-transfers-receive-new':
    'pageTitles.warehouse-transfers-receive-new',
  'warehouse-transfers-discrepancy-new':
    'pageTitles.warehouse-transfers-discrepancy-new',
  'warehouse-transfers-reversal-new':
    'pageTitles.warehouse-transfers-reversal-new',
  'warehouse-transfers-returns-new':
    'pageTitles.warehouse-transfers-returns-new',
  'warehouse-transfers-execution-document':
    'pageTitles.warehouse-transfers-execution-document',
  'warehouse-transfers-execution-document-edit':
    'pageTitles.warehouse-transfers-execution-document-edit',
  'warehouse-transfers-execution-document-action':
    'pageTitles.warehouse-transfers-execution-document-action',
  'warehouse-transfers-execution-document-version':
    'pageTitles.warehouse-transfers-execution-document-version',
  'warehouse-transfers-execution-document-source':
    'pageTitles.warehouse-transfers-execution-document-source',
  'warehouse-transfers-execution-document-reversal':
    'pageTitles.warehouse-transfers-execution-document-reversal',
  'warehouse-transfers-execution-document-returns':
    'pageTitles.warehouse-transfers-execution-document-returns',
  'warehouse-counts-new': 'pageTitles.warehouse-counts-new',
  'warehouse-counts-list-edit': 'pageTitles.warehouse-counts-list-edit',
  'warehouse-counts-detail': 'pageTitles.warehouse-counts-detail',
  'warehouse-counts-edit': 'pageTitles.warehouse-counts-edit',
  'warehouse-counts-copy': 'pageTitles.warehouse-counts-copy',
  'warehouse-counts-action': 'pageTitles.warehouse-counts-action',
  'warehouse-counts-version': 'pageTitles.warehouse-counts-version',
  'warehouse-counts-related': 'pageTitles.warehouse-counts-related',
  'warehouse-counts-receipts-new': 'pageTitles.warehouse-counts-receipts-new',
  'warehouse-counts-shipments-new': 'pageTitles.warehouse-counts-shipments-new',
  'warehouse-counts-dispatch-new': 'pageTitles.warehouse-counts-dispatch-new',
  'warehouse-counts-receive-new': 'pageTitles.warehouse-counts-receive-new',
  'warehouse-counts-discrepancy-new':
    'pageTitles.warehouse-counts-discrepancy-new',
  'warehouse-counts-reversal-new': 'pageTitles.warehouse-counts-reversal-new',
  'warehouse-counts-returns-new': 'pageTitles.warehouse-counts-returns-new',
  'warehouse-counts-execution-document':
    'pageTitles.warehouse-counts-execution-document',
  'warehouse-counts-execution-document-edit':
    'pageTitles.warehouse-counts-execution-document-edit',
  'warehouse-counts-execution-document-action':
    'pageTitles.warehouse-counts-execution-document-action',
  'warehouse-counts-execution-document-version':
    'pageTitles.warehouse-counts-execution-document-version',
  'warehouse-counts-execution-document-source':
    'pageTitles.warehouse-counts-execution-document-source',
  'warehouse-counts-execution-document-reversal':
    'pageTitles.warehouse-counts-execution-document-reversal',
  'warehouse-counts-execution-document-returns':
    'pageTitles.warehouse-counts-execution-document-returns',
  'warehouse-inventory-reserve': 'pageTitles.warehouse-inventory-reserve',
  'warehouse-inventory-release': 'pageTitles.warehouse-inventory-release',
  'warehouse-inventory-facts': 'pageTitles.warehouse-inventory-facts',
  'warehouse-settings-edit': 'pageTitles.warehouse-settings-edit',
  'warehouse-material-warehouses-new':
    'pageTitles.warehouse-material-warehouses-new',
  'warehouse-material-warehouses-edit':
    'pageTitles.warehouse-material-warehouses-edit',
  'warehouse-material-warehouses-detail':
    'pageTitles.warehouse-material-warehouses-detail',
  'warehouse-material-warehouses-detail-edit':
    'pageTitles.warehouse-material-warehouses-detail-edit',
  'warehouse-material-warehouses-action':
    'pageTitles.warehouse-material-warehouses-action',
  'procurement-requests-new': 'pageTitles.procurement-requests-new',
  'procurement-requests-new-material':
    'pageTitles.procurement-requests-new-material',
  'procurement-requests-list-edit': 'pageTitles.procurement-requests-list-edit',
  'procurement-requests-list-edit-material':
    'pageTitles.procurement-requests-list-edit-material',
  'procurement-requests-detail': 'pageTitles.procurement-requests-detail',
  'procurement-requests-edit': 'pageTitles.procurement-requests-edit',
  'procurement-requests-edit-material':
    'pageTitles.procurement-requests-edit-material',
  'procurement-requests-action': 'pageTitles.procurement-requests-action',
  'procurement-requests-source-action':
    'pageTitles.procurement-requests-source-action',
  'procurement-requests-version': 'pageTitles.procurement-requests-version',
  'procurement-requests-copy': 'pageTitles.procurement-requests-copy',
  'procurement-requests-copy-material':
    'pageTitles.procurement-requests-copy-material',
  'procurement-requests-related': 'pageTitles.procurement-requests-related',
  'procurement-requests-related-version':
    'pageTitles.procurement-requests-related-version',
  'procurement-orders-new': 'pageTitles.procurement-orders-new',
  'procurement-orders-list-edit': 'pageTitles.procurement-orders-list-edit',
  'procurement-orders-detail': 'pageTitles.procurement-orders-detail',
  'procurement-orders-edit': 'pageTitles.procurement-orders-edit',
  'procurement-orders-copy': 'pageTitles.procurement-orders-copy',
  'procurement-orders-action': 'pageTitles.procurement-orders-action',
  'procurement-orders-version': 'pageTitles.procurement-orders-version',
  'procurement-orders-related': 'pageTitles.procurement-orders-related',
  'procurement-orders-receipts-new':
    'pageTitles.procurement-orders-receipts-new',
  'procurement-orders-shipments-new':
    'pageTitles.procurement-orders-shipments-new',
  'procurement-orders-dispatch-new':
    'pageTitles.procurement-orders-dispatch-new',
  'procurement-orders-receive-new': 'pageTitles.procurement-orders-receive-new',
  'procurement-orders-discrepancy-new':
    'pageTitles.procurement-orders-discrepancy-new',
  'procurement-orders-reversal-new':
    'pageTitles.procurement-orders-reversal-new',
  'procurement-orders-returns-new': 'pageTitles.procurement-orders-returns-new',
  'procurement-orders-execution-document':
    'pageTitles.procurement-orders-execution-document',
  'procurement-orders-execution-document-edit':
    'pageTitles.procurement-orders-execution-document-edit',
  'procurement-orders-execution-document-action':
    'pageTitles.procurement-orders-execution-document-action',
  'procurement-orders-execution-document-version':
    'pageTitles.procurement-orders-execution-document-version',
  'procurement-orders-execution-document-source':
    'pageTitles.procurement-orders-execution-document-source',
  'procurement-orders-execution-document-reversal':
    'pageTitles.procurement-orders-execution-document-reversal',
  'procurement-orders-execution-document-returns':
    'pageTitles.procurement-orders-execution-document-returns',
  'procurement-suppliers-new': 'pageTitles.procurement-suppliers-new',
  'procurement-suppliers-directory':
    'pageTitles.procurement-suppliers-directory',
  'procurement-suppliers-directory-scope':
    'pageTitles.procurement-suppliers-directory-scope',
  'procurement-suppliers-directory-identity':
    'pageTitles.procurement-suppliers-directory-identity',
  'procurement-suppliers-directory-action':
    'pageTitles.procurement-suppliers-directory-action',
  'procurement-suppliers-detail': 'pageTitles.procurement-suppliers-detail',
  'procurement-suppliers-edit': 'pageTitles.procurement-suppliers-edit',
  'procurement-suppliers-identity': 'pageTitles.procurement-suppliers-identity',
  'procurement-suppliers-scope': 'pageTitles.procurement-suppliers-scope',
  'procurement-suppliers-action': 'pageTitles.procurement-suppliers-action',
  'requisitions-requests-new': 'pageTitles.requisitions-requests-new',
  'requisitions-requests-new-material':
    'pageTitles.requisitions-requests-new-material',
  'requisitions-requests-list-edit':
    'pageTitles.requisitions-requests-list-edit',
  'requisitions-requests-list-edit-material':
    'pageTitles.requisitions-requests-list-edit-material',
  'requisitions-requests-detail': 'pageTitles.requisitions-requests-detail',
  'requisitions-requests-edit': 'pageTitles.requisitions-requests-edit',
  'requisitions-requests-edit-material':
    'pageTitles.requisitions-requests-edit-material',
  'requisitions-requests-action': 'pageTitles.requisitions-requests-action',
  'requisitions-requests-source-action':
    'pageTitles.requisitions-requests-source-action',
  'requisitions-requests-version': 'pageTitles.requisitions-requests-version',
  'requisitions-requests-copy': 'pageTitles.requisitions-requests-copy',
  'requisitions-requests-copy-material':
    'pageTitles.requisitions-requests-copy-material',
  'requisitions-requests-related': 'pageTitles.requisitions-requests-related',
  'requisitions-requests-related-version':
    'pageTitles.requisitions-requests-related-version',
  'requisitions-purposes-new': 'pageTitles.requisitions-purposes-new',
  'requisitions-purposes-detail': 'pageTitles.requisitions-purposes-detail',
  'requisitions-purposes-edit': 'pageTitles.requisitions-purposes-edit',
  'requisitions-purposes-action': 'pageTitles.requisitions-purposes-action',
  'sales-customers-new': 'pageTitles.sales-customers-new',
  'sales-customers-attach': 'pageTitles.sales-customers-attach',
  'sales-customers-directory': 'pageTitles.sales-customers-directory',
  'sales-customers-directory-scope':
    'pageTitles.sales-customers-directory-scope',
  'sales-customers-directory-identity':
    'pageTitles.sales-customers-directory-identity',
  'sales-customers-directory-action':
    'pageTitles.sales-customers-directory-action',
  'sales-customers-detail': 'pageTitles.sales-customers-detail',
  'sales-customers-edit': 'pageTitles.sales-customers-edit',
  'sales-customers-identity': 'pageTitles.sales-customers-identity',
  'sales-customers-scope': 'pageTitles.sales-customers-scope',
  'sales-customers-action': 'pageTitles.sales-customers-action',
  'sales-orders-new': 'pageTitles.sales-orders-new',
  'sales-orders-list-edit': 'pageTitles.sales-orders-list-edit',
  'sales-orders-detail': 'pageTitles.sales-orders-detail',
  'sales-orders-edit': 'pageTitles.sales-orders-edit',
  'sales-orders-copy': 'pageTitles.sales-orders-copy',
  'sales-orders-action': 'pageTitles.sales-orders-action',
  'sales-orders-version': 'pageTitles.sales-orders-version',
  'sales-orders-related': 'pageTitles.sales-orders-related',
  'sales-orders-receipts-new': 'pageTitles.sales-orders-receipts-new',
  'sales-orders-shipments-new': 'pageTitles.sales-orders-shipments-new',
  'sales-orders-dispatch-new': 'pageTitles.sales-orders-dispatch-new',
  'sales-orders-receive-new': 'pageTitles.sales-orders-receive-new',
  'sales-orders-discrepancy-new': 'pageTitles.sales-orders-discrepancy-new',
  'sales-orders-reversal-new': 'pageTitles.sales-orders-reversal-new',
  'sales-orders-returns-new': 'pageTitles.sales-orders-returns-new',
  'sales-orders-execution-document':
    'pageTitles.sales-orders-execution-document',
  'sales-orders-execution-document-edit':
    'pageTitles.sales-orders-execution-document-edit',
  'sales-orders-execution-document-action':
    'pageTitles.sales-orders-execution-document-action',
  'sales-orders-execution-document-version':
    'pageTitles.sales-orders-execution-document-version',
  'sales-orders-execution-document-source':
    'pageTitles.sales-orders-execution-document-source',
  'sales-orders-execution-document-reversal':
    'pageTitles.sales-orders-execution-document-reversal',
  'sales-orders-execution-document-returns':
    'pageTitles.sales-orders-execution-document-returns',
  'sales-orders-reserve': 'pageTitles.sales-orders-reserve',
  'sales-settings-edit': 'pageTitles.sales-settings-edit',
  'people-employees-new': 'pageTitles.people-employees-new',
  'people-employees-edit': 'pageTitles.people-employees-edit',
  'people-employees-detail': 'pageTitles.people-employees-detail',
  'people-employees-detail-edit': 'pageTitles.people-employees-detail-edit',
  'people-employees-detail-action': 'pageTitles.people-employees-detail-action',
  'people-employments-new': 'pageTitles.people-employments-new',
  'people-employments-edit': 'pageTitles.people-employments-edit',
  'people-employments-detail': 'pageTitles.people-employments-detail',
  'people-employments-detail-edit': 'pageTitles.people-employments-detail-edit',
  'people-employments-detail-action':
    'pageTitles.people-employments-detail-action',
  'people-assignments-new': 'pageTitles.people-assignments-new',
  'people-assignments-edit': 'pageTitles.people-assignments-edit',
  'people-assignments-detail': 'pageTitles.people-assignments-detail',
  'people-assignments-detail-edit': 'pageTitles.people-assignments-detail-edit',
  'people-assignments-detail-action':
    'pageTitles.people-assignments-detail-action',
  'people-changes-new': 'pageTitles.people-changes-new',
  'people-changes-edit': 'pageTitles.people-changes-edit',
  'people-changes-detail': 'pageTitles.people-changes-detail',
  'people-changes-detail-edit': 'pageTitles.people-changes-detail-edit',
  'people-changes-detail-action': 'pageTitles.people-changes-detail-action',
};

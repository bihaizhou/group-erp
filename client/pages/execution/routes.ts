import {
  ClipboardCheck,
  ClipboardList,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  Boxes,
  Handshake,
  Users,
  SlidersHorizontal,
  LayoutDashboard,
} from 'lucide-react';
import type { AppClientRouteDefinition as Route } from '@nocobase/app-client/plugins';
import { executionPages } from './model.js';
const authz = (id: string) => ({
  resource: { type: 'page' as const, id },
  action: 'access',
});
export const executionRoutes: Route[] = executionPages.map((config) => ({
  name: config.page,
  path: config.base,
  auth: 'required',
  authz: authz(config.page),
  companyScope: {
    purchaseOrders: 'procurement/orders/companies',
    salesOrders: 'sales/orders/companies',
    inbounds: 'warehouse/documents/companies',
    outbounds: 'warehouse/documents/companies',
    stockTransfers: 'warehouse/transfers/companies',
    stockCounts: 'warehouse/counts/companies',
  }[config.kind],
  navigation: {
    title: `execution.titles.${config.kind}`,
    icon: {
      purchaseOrders: ClipboardList,
      salesOrders: Handshake,
      inbounds: ArrowDownToLine,
      outbounds: ArrowUpFromLine,
      stockTransfers: ArrowLeftRight,
      stockCounts: ClipboardCheck,
    }[config.kind],
  },
  componentLoader: () => import('./index.js'),
  children: [
    {
      name: `${config.page}-new`,
      path: 'new',
      componentLoader: () => import('./form.js'),
    },
    {
      name: `${config.page}-list-edit`,
      path: 'edit/:id',
      componentLoader: () => import('./form.js'),
    },
    {
      name: `${config.page}-detail`,
      path: ':id',
      componentLoader: () => import('./detail.js'),
      children: [
        {
          name: `${config.page}-edit`,
          path: 'edit',
          componentLoader: () => import('./form.js'),
        },
        {
          name: `${config.page}-copy`,
          path: 'copy',
          componentLoader: () => import('./form.js'),
        },
        {
          name: `${config.page}-action`,
          path: 'actions/:action',
          componentLoader: () => import('./action.js'),
        },
        {
          name: `${config.page}-version`,
          path: 'versions/:versionId',
          componentLoader: () => import('./readonly.js'),
        },
        {
          name: `${config.page}-related`,
          path: 'related/:relatedId',
          componentLoader: () => import('./readonly.js'),
        },
        ...[
          'receipts',
          'shipments',
          'dispatch',
          'receive',
          'discrepancy',
          'reversal',
          'returns',
        ].map((kind) => ({
          name: `${config.page}-${kind}-new`,
          path: `${kind}/new`,
          componentLoader: () => import('./form.js'),
        })),
        {
          name: `${config.page}-execution-document`,
          path: 'documents/:documentId',
          componentLoader: () => import('./detail.js'),
          children: [
            {
              name: `${config.page}-execution-document-edit`,
              path: 'edit',
              componentLoader: () => import('./form.js'),
            },
            {
              name: `${config.page}-execution-document-action`,
              path: 'actions/:action',
              componentLoader: () => import('./action.js'),
            },
            {
              name: `${config.page}-execution-document-version`,
              path: 'versions/:versionId',
              componentLoader: () => import('./readonly.js'),
            },
            {
              name: `${config.page}-execution-document-source`,
              path: 'related/:relatedId',
              componentLoader: () => import('./readonly.js'),
            },
            ...['reversal', 'returns'].map((kind) => ({
              name: `${config.page}-execution-document-${kind}`,
              path: `${kind}/new`,
              componentLoader: () => import('./form.js'),
            })),
          ],
        },
        ...(config.kind === 'salesOrders'
          ? [
              {
                name: `${config.page}-reserve`,
                path: 'reserve',
                componentLoader: () => import('./reservation.js'),
              },
            ]
          : []),
      ],
    },
  ],
}));
export const inventoryRoute: Route = {
  name: 'warehouse-inventory',
  path: '/functions/warehouse/inventory',
  auth: 'required',
  authz: authz('warehouse-inventory'),
  companyScope: 'warehouse/inventory/companies',
  navigation: { title: 'execution.inventory', icon: Boxes },
  componentLoader: () => import('./inventory.js'),
  children: [
    {
      name: 'warehouse-inventory-reserve',
      path: 'reserve',
      componentLoader: () => import('./reservation.js'),
    },
    {
      name: 'warehouse-inventory-release',
      path: ':reservationId/release',
      componentLoader: () => import('./reservation.js'),
    },
    {
      name: 'warehouse-inventory-facts',
      path: ':balanceId/:factKind',
      componentLoader: () => import('./facts.js'),
    },
  ],
};
export const salesRoutes: Route[] = [
  {
    name: 'sales',
    navigation: { title: 'customers.title', icon: Handshake },
    children: [
      {
        name: 'sales-overview',
        path: '/functions/sales/overview',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'sales-overview' },
          action: 'access',
        },
        companyScope: 'sales/orders/companies',
        navigation: { title: 'dashboard.menu', icon: LayoutDashboard },
        componentLoader: () => import('./sales-overview.js'),
      },
      {
        name: 'sales-customers',
        path: '/functions/sales/customers',
        auth: 'required',
        authz: authz('sales-customers'),
        companyScope: 'procurement/supplierCompanies',
        navigation: { title: 'customers.customers', icon: Users },
        componentLoader: () => import('../customers/index.js'),
        children: [
          {
            name: 'sales-customers-new',
            path: 'new',
            componentLoader: () => import('../suppliers/form.js'),
          },
          {
            name: 'sales-customers-attach',
            path: 'attach',
            componentLoader: () => import('../customers/attach.js'),
          },
          {
            name: 'sales-customers-directory',
            path: 'directory',
            componentLoader: () => import('../suppliers/directory.js'),
            children: [
              {
                name: 'sales-customers-directory-scope',
                path: ':partnerId/scope',
                componentLoader: () => import('../suppliers/form.js'),
              },
              {
                name: 'sales-customers-directory-identity',
                path: ':partnerId/identity',
                componentLoader: () => import('../suppliers/form.js'),
              },
              {
                name: 'sales-customers-directory-action',
                path: ':partnerId/global/:transition',
                componentLoader: () => import('../suppliers/action.js'),
              },
            ],
          },
          {
            name: 'sales-customers-detail',
            path: ':partnerId',
            componentLoader: () => import('../suppliers/detail.js'),
            children: [
              ...['edit', 'identity', 'scope'].map((path) => ({
                name: `sales-customers-${path}`,
                path,
                componentLoader: () => import('../suppliers/form.js'),
              })),
              {
                name: 'sales-customers-action',
                path: ':target/:transition',
                componentLoader: () => import('../suppliers/action.js'),
              },
            ],
          },
        ],
      },
      ...executionRoutes.filter((route) => route.name === 'sales-orders'),
      {
        name: 'sales-settings',
        path: '/functions/sales/settings',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'sales-review-settings' },
          action: 'access',
        },
        companyScope: 'warehouse/settings/companies',
        navigation: { title: 'reviewSettings.sales', icon: SlidersHorizontal },
        componentLoader: () => import('../review-settings/sales-page.js'),
      },
      {
        name: 'sales-settings-edit',
        path: '/functions/sales/settings/edit/:parameter',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'sales-review-settings' },
          action: 'access',
        },
        companyScope: 'warehouse/settings/companies',
        componentLoader: () => import('./settings-edit.js'),
      },
    ],
  },
];
export const warehouseExecutionRoutes: Route[] = [
  {
    name: 'warehouse-overview',
    path: '/functions/warehouse/overview',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'warehouse-overview' },
      action: 'access',
    },
    companyScope: 'warehouse/documents/companies',
    navigation: { title: 'dashboard.menu', icon: LayoutDashboard },
    componentLoader: () => import('./warehouse-overview.js'),
  },
  ...executionRoutes.filter((route) => route.name.startsWith('warehouse-')),
  inventoryRoute,
  {
    name: 'warehouse-settings',
    path: '/functions/warehouse/settings',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'warehouse-review-settings' },
      action: 'access',
    },
    companyScope: 'warehouse/settings/companies',
    navigation: { title: 'reviewSettings.warehouse', icon: SlidersHorizontal },
    componentLoader: () => import('../review-settings/warehouse-page.js'),
  },
  {
    name: 'warehouse-settings-edit',
    path: '/functions/warehouse/settings/edit/:parameter',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'warehouse-review-settings' },
      action: 'access',
    },
    companyScope: 'warehouse/settings/companies',
    componentLoader: () => import('./settings-edit.js'),
  },
];
export const procurementExecutionRoutes: Route[] = executionRoutes.filter(
  (route) => route.name === 'procurement-orders',
);

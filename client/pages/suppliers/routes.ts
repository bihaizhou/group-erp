import { procurementExecutionRoutes } from '../execution/routes.js';
import { purchaseRoutes } from '../procurement/requests/routes.js';
import {
  LayoutDashboard,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
} from 'lucide-react';
import type { AppClientRouteDefinition } from '@nocobase/app-client/plugins';
export const procurementRoutes: AppClientRouteDefinition[] = [
  {
    name: 'procurement',
    navigation: { title: 'procurement.title', icon: ShoppingCart },
    children: [
      {
        name: 'procurement-overview',
        path: '/functions/procurement/overview',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'procurement-overview' },
          action: 'access',
        },
        companyScope: 'procurement/requestCompanies',
        navigation: { title: 'dashboard.menu', icon: LayoutDashboard },
        componentLoader: () => import('../procurement/overview.js'),
      },
      ...purchaseRoutes,
      ...procurementExecutionRoutes,
      {
        name: 'procurement-suppliers',
        path: '/functions/procurement/suppliers',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'procurement-suppliers' },
          action: 'access',
        },
        companyScope: 'procurement/supplierCompanies',
        navigation: { title: 'procurement.suppliers', icon: Truck },
        componentLoader: () => import('./list.js'),
        children: [
          {
            name: 'procurement-suppliers-new',
            path: 'new',
            componentLoader: () => import('./form.js'),
          },
          {
            name: 'procurement-suppliers-directory',
            path: 'directory',
            componentLoader: () => import('./directory.js'),
            children: [
              {
                name: 'procurement-suppliers-directory-scope',
                path: ':partnerId/scope',
                componentLoader: () => import('./form.js'),
              },
              {
                name: 'procurement-suppliers-directory-identity',
                path: ':partnerId/identity',
                componentLoader: () => import('./form.js'),
              },
              {
                name: 'procurement-suppliers-directory-action',
                path: ':partnerId/global/:transition',
                componentLoader: () => import('./action.js'),
              },
            ],
          },
          {
            name: 'procurement-suppliers-detail',
            path: ':partnerId',
            componentLoader: () => import('./detail.js'),
            children: [
              {
                name: 'procurement-suppliers-edit',
                path: 'edit',
                componentLoader: () => import('./form.js'),
              },
              {
                name: 'procurement-suppliers-identity',
                path: 'identity',
                componentLoader: () => import('./form.js'),
              },
              {
                name: 'procurement-suppliers-scope',
                path: 'scope',
                componentLoader: () => import('./form.js'),
              },
              {
                name: 'procurement-suppliers-action',
                path: ':target/:transition',
                componentLoader: () => import('./action.js'),
              },
            ],
          },
        ],
      },
      {
        name: 'procurement-settings',
        path: '/functions/procurement/settings',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'procurement-review-settings' },
          action: 'access',
        },
        companyScope: 'procurement/settings/companies',
        navigation: {
          title: 'reviewSettings.procurement',
          icon: SlidersHorizontal,
        },
        componentLoader: () => import('../review-settings/procurement-page.js'),
      },
    ],
  },
];

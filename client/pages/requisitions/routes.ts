import {
  ClipboardCheck,
  LayoutDashboard,
  SlidersHorizontal,
  Tags,
} from 'lucide-react';
import type { AppClientRouteDefinition } from '@nocobase/app-client/plugins';
import { issueRoutes } from './requests/routes.js';
export const requisitionsRoutes: AppClientRouteDefinition[] = [
  {
    name: 'requisitions',
    navigation: { title: 'requisitions.title', icon: ClipboardCheck },
    children: [
      {
        name: 'requisitions-overview',
        path: '/functions/requisitions/overview',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'requisitions-overview' },
          action: 'access',
        },
        companyScope: 'requisitions/requestCompanies',
        navigation: { title: 'dashboard.menu', icon: LayoutDashboard },
        componentLoader: () => import('./overview.js'),
      },
      ...issueRoutes,
      {
        name: 'requisitions-purposes',
        path: '/functions/requisitions/purposes',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'requisitions-purposes' },
          action: 'access',
        },
        companyScope: 'requisitions/purposeCompanies',
        navigation: { title: 'requisitions.purposes.title', icon: Tags },
        componentLoader: () => import('./purposes/index.js'),
        children: [
          {
            name: 'requisitions-purposes-new',
            path: 'new',
            componentLoader: () => import('./purposes/form.js'),
          },
          {
            name: 'requisitions-purposes-detail',
            path: ':purposeId',
            componentLoader: () => import('./purposes/detail.js'),
            children: [
              {
                name: 'requisitions-purposes-edit',
                path: 'edit',
                componentLoader: () => import('./purposes/form.js'),
              },
              {
                name: 'requisitions-purposes-action',
                path: 'actions/:transition',
                componentLoader: () => import('./purposes/form.js'),
              },
            ],
          },
        ],
      },
      {
        name: 'requisitions-settings',
        path: '/functions/requisitions/settings',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'requisitions-review-settings' },
          action: 'access',
        },
        companyScope: 'requisitions/settings/companies',
        navigation: {
          title: 'reviewSettings.requisitions',
          icon: SlidersHorizontal,
        },
        componentLoader: () =>
          import('../review-settings/requisitions-page.js'),
      },
    ],
  },
];

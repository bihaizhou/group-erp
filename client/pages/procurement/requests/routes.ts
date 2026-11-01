import { ClipboardList } from 'lucide-react';
import type { AppClientRouteDefinition } from '@nocobase/app-client/plugins';
const picker = (prefix: string): AppClientRouteDefinition => ({
  name: `${prefix}-material`,
  path: 'lines/:lineId/select',
  componentLoader: () => import('./material-picker.js'),
});
const version = (prefix: string): AppClientRouteDefinition => ({
  name: `${prefix}-version`,
  path: 'versions/:versionId',
  componentLoader: () => import('./detail/version.js'),
});
export const purchaseRoutes: AppClientRouteDefinition[] = [
  {
    name: 'procurement-requests',
    path: '/functions/procurement/requests',
    auth: 'required',
    companyScope: 'procurement/requestCompanies',
    authz: {
      resource: { type: 'page', id: 'procurement-requests' },
      action: 'access',
    },
    navigation: { title: 'procurement.requestUi.title', icon: ClipboardList },
    componentLoader: () => import('./index.js'),
    children: [
      {
        name: 'procurement-requests-new',
        path: 'new',
        componentLoader: () => import('./request-form.js'),
        children: [picker('procurement-requests-new')],
      },
      {
        name: 'procurement-requests-list-edit',
        path: 'edit/:requestId',
        componentLoader: () => import('./request-form.js'),
        children: [picker('procurement-requests-list-edit')],
      },
      {
        name: 'procurement-requests-detail',
        path: ':requestId',
        componentLoader: () => import('./detail/index.js'),
        children: [
          {
            name: 'procurement-requests-edit',
            path: 'edit',
            componentLoader: () => import('./request-form.js'),
            children: [picker('procurement-requests-edit')],
          },
          {
            name: 'procurement-requests-action',
            path: 'actions/:transition',
            componentLoader: () => import('./detail/action.js'),
          },
          {
            name: 'procurement-requests-source-action',
            path: 'lines/:lineId/governance/:sourceAction',
            componentLoader: () => import('./detail/source-action.js'),
          },
          version('procurement-requests'),
          {
            name: 'procurement-requests-copy',
            path: 'copy',
            componentLoader: () => import('./request-form.js'),
            children: [picker('procurement-requests-copy')],
          },
          {
            name: 'procurement-requests-related',
            path: 'related/:relatedId',
            componentLoader: () => import('./detail/index.js'),
            children: [version('procurement-requests-related')],
          },
        ],
      },
    ],
  },
];

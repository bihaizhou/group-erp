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
export const issueRoutes: AppClientRouteDefinition[] = [
  {
    name: 'requisitions-requests',
    path: '/functions/requisitions/requests',
    auth: 'required',
    companyScope: 'requisitions/requestCompanies',
    authz: {
      resource: { type: 'page', id: 'requisitions-requests' },
      action: 'access',
    },
    navigation: { title: 'requisitions.requestUi.title', icon: ClipboardList },
    componentLoader: () => import('./index.js'),
    children: [
      {
        name: 'requisitions-requests-new',
        path: 'new',
        componentLoader: () => import('./request-form.js'),
        children: [picker('requisitions-requests-new')],
      },
      {
        name: 'requisitions-requests-list-edit',
        path: 'edit/:requestId',
        componentLoader: () => import('./request-form.js'),
        children: [picker('requisitions-requests-list-edit')],
      },
      {
        name: 'requisitions-requests-detail',
        path: ':requestId',
        componentLoader: () => import('./detail/index.js'),
        children: [
          {
            name: 'requisitions-requests-edit',
            path: 'edit',
            componentLoader: () => import('./request-form.js'),
            children: [picker('requisitions-requests-edit')],
          },
          {
            name: 'requisitions-requests-action',
            path: 'actions/:transition',
            componentLoader: () => import('./detail/action.js'),
          },
          {
            name: 'requisitions-requests-source-action',
            path: 'lines/:lineId/governance/:sourceAction',
            componentLoader: () => import('./detail/source-action.js'),
          },
          version('requisitions-requests'),
          {
            name: 'requisitions-requests-copy',
            path: 'copy',
            componentLoader: () => import('./request-form.js'),
            children: [picker('requisitions-requests-copy')],
          },
          {
            name: 'requisitions-requests-related',
            path: 'related/:relatedId',
            componentLoader: () => import('./detail/index.js'),
            children: [version('requisitions-requests-related')],
          },
        ],
      },
    ],
  },
];

import { Landmark } from 'lucide-react';
import type { AppClientRouteDefinition } from '@nocobase/app-client/plugins';
import { declarePageDataResources } from '../../routing/page-data-resources.js';

// Preview page: it owns no business collection yet, so an empty declaration
// keeps the field editor closed until finance data resources are added.
declarePageDataResources('finance-overview', []);

export const financeRoutes: AppClientRouteDefinition[] = [
  {
    name: 'finance',
    navigation: { title: 'finance.title', icon: Landmark, order: 60 },
    children: [
      {
        name: 'finance-overview',
        path: '/functions/finance',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'finance-overview' },
          action: 'access',
        },
        navigation: { title: 'finance.overview', icon: Landmark },
        componentLoader: () => import('./index.js'),
      },
    ],
  },
];

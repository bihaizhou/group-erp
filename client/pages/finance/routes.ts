import { Landmark } from 'lucide-react';
import type { AppClientRouteDefinition } from '@nocobase/app-client/plugins';
import { declarePageDataResources } from '../../routing/page-data-resources.js';

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
        // A preview page owns no business collection yet, so it declares no
        // page-level field resources and stays out of the field drawer.
        dataResources: [],
        componentLoader: () => import('./index.js'),
      },
    ],
  },
];

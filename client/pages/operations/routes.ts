import {
  ChartNoAxesCombined,
  ClipboardList,
  LayoutDashboard,
  Target,
} from 'lucide-react';
import type { AppClientRouteDefinition } from '@nocobase/app-client/plugins';

export const operationsRoutes: AppClientRouteDefinition[] = [
  {
    name: 'operations',
    navigation: {
      title: 'operations.title',
      icon: ChartNoAxesCombined,
      // Siblings sort by ascending navigation.order; pin operations above them.
      order: -2,
    },
    children: [
      {
        name: 'operations-overview',
        path: '/functions/operations/overview',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'operations-overview' },
          action: 'access',
        },
        navigation: { title: 'operations.overview', icon: LayoutDashboard },
        componentLoader: () => import('./overview.js'),
      },
      {
        name: 'operations-issues',
        path: '/functions/operations/issues',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'operations-issues' },
          action: 'access',
        },
        navigation: { title: 'operations.issues', icon: ClipboardList },
        componentLoader: () => import('./issues.js'),
      },
      {
        name: 'operations-targets',
        path: '/functions/operations/targets',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'operations-targets' },
          action: 'access',
        },
        navigation: { title: 'operations.targets', icon: Target },
        componentLoader: () => import('./targets.js'),
      },
    ],
  },
];

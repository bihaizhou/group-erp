import { Boxes } from 'lucide-react';
import type { AppClientRouteDefinition } from '@nocobase/app-client/plugins';

const pageAuthz = (id: string) =>
  ({ resource: { type: 'page', id }, action: 'access' }) as const;

export const assetsRoutes: AppClientRouteDefinition[] = [
  {
    name: 'assets',
    navigation: { title: 'assets.title', icon: Boxes, order: 55 },
    children: [
      {
        name: 'assets-list',
        path: '/functions/assets',
        auth: 'required',
        authz: pageAuthz('people-assets'),
        navigation: { title: 'assets.title', icon: Boxes },
        componentLoader: () => import('./index.js'),
      },
    ],
  },
];

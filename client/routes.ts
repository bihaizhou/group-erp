import { peopleRoutes } from './pages/people/routes.js';
import systemSettingsRoutes from './pages/settings/routes.js';
import { functionModuleRoutes } from './module-manifest.js';
import {
  Home,
  Network,
  GitBranch,
  Building2,
  Layers,
  BriefcaseBusiness,
  Shapes,
  Globe2,
  Waypoints,
  ShieldCheck,
} from 'lucide-react';
import {
  defineAppRoutes,
  type AppClientRouteContribution,
  type AppClientRouteDefinition,
} from '@nocobase/app-client/plugins';

const organizationAuth = {
  resource: { type: 'settings', id: 'organization' },
  action: 'read',
} as const;
const organizationLoaders = {
  subjects: () => import('./pages/organization/subjects.js'),
  units: () => import('./pages/organization/units.js'),
  positions: () => import('./pages/organization/positions.js'),
  sectors: () => import('./pages/organization/sectors.js'),
  regions: () => import('./pages/organization/regions.js'),
  relations: () => import('./pages/organization/relations.js'),
};
const organizationIcons = {
  subjects: Building2,
  units: Layers,
  positions: BriefcaseBusiness,
  sectors: Shapes,
  regions: Globe2,
  relations: Waypoints,
};
function organizationChildren(kind: string): AppClientRouteDefinition[] {
  return [
    {
      name: `organization-${kind}-new`,
      path: 'new',
      componentLoader: () => import('./pages/organization/form.js'),
    },
    {
      name: `organization-${kind}-edit`,
      path: 'edit/:recordId',
      componentLoader: () => import('./pages/organization/form.js'),
    },
    {
      name: `organization-${kind}-detail`,
      path: ':recordId',
      componentLoader: () => import('./pages/organization/detail.js'),
      children: [
        {
          name: `organization-${kind}-detail-edit`,
          path: 'edit',
          componentLoader: () => import('./pages/organization/form.js'),
        },
      ],
    },
  ];
}

const appRoutes: AppClientRouteContribution = defineAppRoutes([
  ...peopleRoutes.map((route) =>
    route.name === 'functions'
      ? {
          ...route,
          children: [...functionModuleRoutes, ...(route.children ?? [])],
        }
      : route,
  ),
  {
    name: 'organization',
    navigation: { title: 'org.title', icon: Network, order: 10 },
    children: [
      {
        name: 'organization-overview',
        path: '/organization',
        auth: 'required',
        authz: organizationAuth,
        navigation: { title: 'org.overview', icon: GitBranch },
        componentLoader: () => import('./pages/organization/overview.js'),
      },
      ...Object.entries(organizationLoaders).map(([kind, componentLoader]) => ({
        name: `organization-${kind}`,
        path: `/organization/${kind}`,
        auth: 'required' as const,
        authz: organizationAuth,
        navigation: {
          title: `org.${kind}`,
          icon: organizationIcons[kind as keyof typeof organizationIcons],
        },
        componentLoader,
        children: organizationChildren(kind),
      })),
      {
        name: 'position-permissions',
        path: '/organization/position-permissions',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'position-permissions' },
          action: 'access',
        },
        navigation: {
          title: 'org.positionPermissions',
          icon: ShieldCheck,
        },
        componentLoader: () =>
          import('./pages/organization/position-permissions.js'),
      },
      {
        name: 'organization-history',
        path: '/organization/history',
        auth: 'required',
        authz: organizationAuth,
        componentLoader: () => import('./pages/organization/history.js'),
      },
    ],
  },
  {
    // Every signed-in user reaches the landing page. `authz: 'skip'` takes it out of page authorization entirely, so
    // no permission change can leave a user signed in with nowhere to land.
    authz: 'skip',
    auth: 'required',
    componentLoader: () => import('./pages/home/index.js'),
    name: 'home',
    navigation: { title: 'navigation.home', icon: Home },
    path: '/',
  },
  {
    // Declares no navigation, so the application decides where its entry goes (for example a sidebar item with an
    // unread badge). The plugin's API answers each person's own messages only, so the page needs no authorization of
    // its own.
    authz: 'skip',
    auth: 'required',
    componentLoader: () => import('./pages/inbox.js'),
    name: 'inbox',
    path: '/inbox',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/login.js'),
    name: 'login',
    path: '/login',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/register.js'),
    name: 'register',
    path: '/register',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/forgot-password.js'),
    name: 'forgot-password',
    path: '/forgot-password',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/reset-password.js'),
    name: 'reset-password',
    path: '/reset-password',
  },
  {
    // Where a command line's sign-in sends the person to approve it (`pages/auth/device.tsx`). Optional rather than
    // required so it renders outside the shell, like the sign-in pages; the page sends a guest to sign in and back.
    auth: 'optional',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/device.js'),
    name: 'device',
    path: '/device',
  },
]);

const routes: readonly AppClientRouteContribution[] = [
  appRoutes,
  systemSettingsRoutes,
];

export default routes;

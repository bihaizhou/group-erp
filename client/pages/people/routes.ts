import {
  UsersRound,
  ChartNoAxesCombined,
  PanelsTopLeft,
  Contact,
  FileUser,
  BriefcaseBusiness,
  ArrowLeftRight,
  Shapes,
  Target,
  ContactRound,
  ClipboardCheck,
  TrendingUp,
  ChartNetwork,
  LayoutDashboard,
  Inbox,
  SlidersHorizontal,
} from 'lucide-react';
import type { AppClientRouteDefinition } from '@nocobase/app-client/plugins';
import type { Kind } from './model.js';
const listLoaders = {
  employees: () => import('./entries/employees.js'),
  employments: () => import('./entries/employments.js'),
  assignments: () => import('./entries/assignments.js'),
  changes: () => import('./entries/changes.js'),
  dimensions: () => import('./entries/dimensions.js'),
  models: () => import('./entries/models.js'),
  profiles: () => import('./entries/profiles.js'),
  evaluations: () => import('./entries/evaluations.js'),
  developmentPlans: () => import('./entries/developmentPlans.js'),
  workforcePlans: () => import('./entries/workforcePlans.js'),
};
const detailLoaders = {
  employees: () => import('./entries/detail-employees.js'),
  employments: () => import('./entries/detail-employments.js'),
  assignments: () => import('./entries/detail-assignments.js'),
  changes: () => import('./entries/detail-changes.js'),
  dimensions: () => import('./entries/detail-dimensions.js'),
  models: () => import('./entries/detail-models.js'),
  profiles: () => import('./entries/detail-profiles.js'),
  evaluations: () => import('./entries/detail-evaluations.js'),
  developmentPlans: () => import('./entries/detail-developmentPlans.js'),
  workforcePlans: () => import('./entries/detail-workforcePlans.js'),
};
const icons = {
  employees: Contact,
  employments: FileUser,
  assignments: BriefcaseBusiness,
  changes: ArrowLeftRight,
  dimensions: Shapes,
  models: Target,
  profiles: ContactRound,
  evaluations: ClipboardCheck,
  developmentPlans: TrendingUp,
  workforcePlans: ChartNetwork,
};
function detailChildren(owner: string): AppClientRouteDefinition[] {
  return [
    {
      name: `${owner}-edit`,
      path: 'edit',
      componentLoader: () => import('./form.js'),
    },
    {
      name: `${owner}-action`,
      path: 'actions/:transition',
      componentLoader: () => import('./workflow-action.js'),
    },
  ];
}
function page(kind: Kind): AppClientRouteDefinition {
  const owner = `people-${kind}`;
  const related: AppClientRouteDefinition[] =
    kind === 'profiles'
      ? [
          {
            name: `${owner}-evaluation`,
            path: 'evaluations/:relatedId',
            componentLoader: () => import('./entries/related-evaluations.js'),
            children: detailChildren(`${owner}-evaluation`),
          },
          {
            name: `${owner}-development`,
            path: 'developmentPlans/:relatedId',
            componentLoader: () =>
              import('./entries/related-developmentPlans.js'),
            children: detailChildren(`${owner}-development`),
          },
        ]
      : [];
  return {
    name: owner,
    path:
      kind === 'employees' ||
      kind === 'employments' ||
      kind === 'assignments' ||
      kind === 'changes'
        ? `/functions/personnel/${kind}`
        : `/human-resources/${kind}`,
    auth: 'required',
    authz: { resource: { type: 'page', id: owner }, action: 'access' },
    navigation: { title: `people.${kind}`, icon: icons[kind] },
    componentLoader: listLoaders[kind],
    children: [
      {
        name: `${owner}-new`,
        path: 'new',
        componentLoader: () => import('./form.js'),
      },
      {
        name: `${owner}-edit`,
        path: 'edit/:recordId',
        componentLoader: () => import('./form.js'),
      },
      {
        name: `${owner}-detail`,
        path: ':recordId',
        componentLoader: detailLoaders[kind],
        children: [...detailChildren(`${owner}-detail`), ...related],
      },
    ],
  };
}
export const peopleRoutes: AppClientRouteDefinition[] = [
  {
    name: 'human-resources',
    navigation: { title: 'people.title', icon: UsersRound, order: 20 },
    children: [
      {
        name: 'people-overview',
        path: '/human-resources',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'people-overview' },
          action: 'access',
        },
        navigation: { title: 'people.overview', icon: ChartNoAxesCombined },
        componentLoader: () => import('./overview.js'),
      },
      ...(
        [
          'profiles',
          'dimensions',
          'models',
          'evaluations',
          'developmentPlans',
          'workforcePlans',
        ] as const
      ).map(page),
      {
        name: 'people-history',
        path: '/human-resources/history',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'people-history' },
          action: 'access',
        },
        componentLoader: () => import('./history.js'),
      },
    ],
  },
  {
    name: 'functions',
    navigation: { title: 'erp.functions', icon: PanelsTopLeft, order: 30 },
    children: [
      {
        name: 'personnel',
        navigation: { title: 'people.personnel', icon: UsersRound },
        children: [
          {
            name: 'people-personnel-overview',
            path: '/functions/personnel',
            auth: 'required',
            authz: {
              resource: { type: 'page', id: 'people-personnel-overview' },
              action: 'access',
            },
            navigation: {
              title: 'dashboard.menu',
              icon: LayoutDashboard,
            },
            componentLoader: () => import('./personnel-overview.js'),
          },
          {
            name: 'people-approvals',
            path: '/functions/personnel/approvals',
            auth: 'required',
            authz: {
              resource: { type: 'page', id: 'people-approvals' },
              action: 'access',
            },
            navigation: { title: 'people.approvals', icon: Inbox, order: 5 },
            componentLoader: () => import('./approvals.js'),
          },
          ...(
            ['employees', 'employments', 'assignments', 'changes'] as const
          ).map(page),
          {
            name: 'people-approval-settings',
            path: '/functions/personnel/approval-settings',
            auth: 'required',
            authz: {
              resource: { type: 'page', id: 'people-approval-settings' },
              action: 'access',
            },
            navigation: {
              title: 'people.approvalSettings',
              icon: SlidersHorizontal,
            },
            componentLoader: () => import('./approval-settings.js'),
          },
        ],
      },
    ],
  },
];

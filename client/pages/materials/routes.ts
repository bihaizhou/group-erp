import { warehouseExecutionRoutes } from '../execution/routes.js';
import {
  Warehouse,
  PackageSearch,
  PackageOpen,
  Settings2,
  BookOpen,
  SlidersHorizontal,
  Ruler,
  Boxes,
  Link2,
  Tags,
  Tag,
  ClipboardList,
  Building2,
  PanelsTopLeft,
  LayoutDashboard,
} from 'lucide-react';
import type { AppClientRouteDefinition } from '@nocobase/app-client/plugins';
import { kinds, pathFor, pageId, type Kind } from './model.js';
const icons = {
  skus: PackageOpen,
  names: BookOpen,
  templates: SlidersHorizontal,
  units: Ruler,
  unitRules: Boxes,
  references: Link2,
  tags: Tags,
  tagLinks: Tag,
  requests: ClipboardList,
  subjectSettings: Building2,
  warehouses: Settings2,
};
function children(kind: Kind): AppClientRouteDefinition[] {
  const owner = pageId(kind);
  return [
    ...(kind === 'skus'
      ? [
          {
            name: `${owner}-request-material`,
            path: 'newRequest',
            componentLoader: () => import('./request-form.js'),
          },
        ]
      : []),
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
      path: kind === 'requests' ? ':sourceRequestId' : ':recordId',
      componentLoader: () => import('./detail.js'),
      children: [
        {
          name: `${owner}-detail-edit`,
          path: 'edit',
          componentLoader: () => import('./form.js'),
        },
        {
          name: `${owner}-action`,
          path: 'actions/:transition',
          componentLoader: () => import('./action.js'),
        },
        ...(kind === 'requests'
          ? [
              {
                name: `${owner}-new-sku`,
                path: 'newSku',
                componentLoader: () => import('./form.js'),
              },
              {
                name: `${owner}-linked-sku`,
                path: 'skus/:linkedSkuId',
                componentLoader: () => import('./linked-sku.js'),
                children: [
                  {
                    name: `${owner}-linked-sku-edit`,
                    path: 'edit',
                    componentLoader: () => import('./form.js'),
                  },
                  {
                    name: `${owner}-linked-sku-action`,
                    path: 'actions/:transition',
                    componentLoader: () => import('./action.js'),
                  },
                ],
              },
            ]
          : []),
      ],
    },
  ];
}
const page = (kind: Kind): AppClientRouteDefinition => ({
  name: pageId(kind),
  path: pathFor(kind),
  auth: 'required',
  authz: { resource: { type: 'page', id: pageId(kind) }, action: 'access' },
  navigation: { title: `materials.kinds.${kind}`, icon: icons[kind] },
  componentLoader: () => import('./list.js'),
  children: children(kind),
});
export const warehouseRoutes: AppClientRouteDefinition[] = [
  {
    name: 'functions-workbench',
    path: '/functions',
    auth: 'required',
    authz: 'skip',
    navigation: {
      title: 'materials.workbench',
      icon: PanelsTopLeft,
      // Siblings sort by ascending navigation.order; the workbench closes the list.
      order: 999,
    },
    componentLoader: () => import('./workbench.js'),
  },
  // Material governance serves every business module. Keep the published paths
  // and page grants stable while placing its menu beside warehouse management.
  {
    name: 'warehouse-material-center',
    navigation: { title: 'materials.center', icon: PackageSearch },
    children: [
      {
        name: 'materials-overview',
        path: '/functions/warehouse/materials/overview',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'materials-overview' },
          action: 'access',
        },
        navigation: { title: 'dashboard.menu', icon: LayoutDashboard },
        componentLoader: () => import('./overview.js'),
      },
      page('skus'),
      ...kinds
        .filter((kind) => kind !== 'skus' && kind !== 'warehouses')
        .map(page),
      {
        name: pageId('history'),
        path: '/functions/warehouse/materials/history',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: pageId('history') },
          action: 'access',
        },
        componentLoader: () => import('./history.js'),
      },
    ],
  },
  {
    name: 'warehouse',
    navigation: { title: 'materials.warehouse', icon: Warehouse },
    children: [...warehouseExecutionRoutes, page('warehouses')],
  },
];

import {
  ChartNoAxesCombined,
  ClipboardCheck,
  ClipboardList,
  Network,
  PackageSearch,
  PanelsTopLeft,
  ShieldCheck,
  Tags,
  Truck,
  Users,
  UsersRound,
  Warehouse,
  Building2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface AccessCheck {
  readonly type: 'page' | 'settings';
  readonly id: string;
  readonly action: string;
}

export interface WorkbenchModule {
  readonly id: string;
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly icon: LucideIcon;
  readonly landing: readonly {
    readonly pageId: string;
    readonly path: string;
  }[];
}

export interface HomeModule {
  readonly id: string;
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly icon: LucideIcon;
  readonly path: string | null;
  readonly checks: readonly AccessCheck[];
  /** Show the card when any check passes instead of all of them. */
  readonly any?: boolean;
}

const page = (id: string): AccessCheck => ({
  type: 'page',
  id,
  action: 'access',
});

const module = (
  id: string,
  titleKey: string,
  descriptionKey: string,
  icon: LucideIcon,
  landing: readonly [string, string][],
): WorkbenchModule => ({
  id,
  titleKey,
  descriptionKey,
  icon,
  landing: landing.map(([pageId, path]) => ({ pageId, path })),
});

/** The `functions` workbench. One card per module, one first-authorized link. */
export const workbenchModules: readonly WorkbenchModule[] = [
  module(
    'people',
    'people.personnel',
    'materials.moduleDescriptions.people',
    UsersRound,
    [
      ['people-personnel-overview', '/functions/personnel'],
      ['people-employees', '/functions/personnel/employees'],
    ],
  ),
  module(
    'materials',
    'materials.center',
    'materials.moduleDescriptions.materials',
    PackageSearch,
    [
      ['materials-overview', '/functions/warehouse/materials/overview'],
      ['warehouse-materials', '/functions/warehouse/materials'],
    ],
  ),
  module(
    'warehouse',
    'materials.warehouse',
    'materials.moduleDescriptions.warehouse',
    Warehouse,
    [
      ['warehouse-overview', '/functions/warehouse/overview'],
      ['warehouse-inbounds', '/functions/warehouse/inbounds'],
      ['warehouse-outbounds', '/functions/warehouse/outbounds'],
      ['warehouse-inventory', '/functions/warehouse/inventory'],
      ['warehouse-transfers', '/functions/warehouse/transfers'],
      ['warehouse-counts', '/functions/warehouse/counts'],
      [
        'warehouse-material-warehouses',
        '/functions/warehouse/settings/warehouses',
      ],
      ['warehouse-settings', '/functions/warehouse/settings'],
    ],
  ),
  module(
    'procurement',
    'procurement.title',
    'materials.moduleDescriptions.procurement',
    ClipboardList,
    [
      ['procurement-overview', '/functions/procurement/overview'],
      ['procurement-orders', '/functions/procurement/orders'],
      ['procurement-requests', '/functions/procurement/requests'],
      ['procurement-suppliers', '/functions/procurement/suppliers'],
      ['procurement-settings', '/functions/procurement/settings'],
    ],
  ),
  module(
    'sales',
    'customers.title',
    'materials.moduleDescriptions.sales',
    Truck,
    [
      ['sales-overview', '/functions/sales/overview'],
      ['sales-orders', '/functions/sales/orders'],
      ['sales-customers', '/functions/sales/customers'],
      ['sales-settings', '/functions/sales/settings'],
    ],
  ),
  module(
    'requisitions',
    'requisitions.title',
    'materials.moduleDescriptions.requisitions',
    Tags,
    [
      ['requisitions-overview', '/functions/requisitions/overview'],
      ['requisitions-requests', '/functions/requisitions/requests'],
      ['requisitions-purposes', '/functions/requisitions/purposes'],
      ['requisitions-settings', '/functions/requisitions/settings'],
    ],
  ),
  module(
    'production',
    'production.title',
    'materials.moduleDescriptions.production',
    ClipboardCheck,
    [
      ['production-overview', '/functions/production/overview'],
      ['production-report', '/functions/production/report'],
      ['production-setup', '/functions/production/setup'],
      ['production-shift-reports', '/functions/production/shift-reports'],
    ],
  ),
  module(
    'operations',
    'operations.title',
    'materials.moduleDescriptions.operations',
    ChartNoAxesCombined,
    [
      ['operations-overview', '/functions/operations/overview'],
      ['operations-issues', '/functions/operations/issues'],
      ['operations-targets', '/functions/operations/targets'],
    ],
  ),
  module('hse', 'hse.title', 'materials.moduleDescriptions.hse', ShieldCheck, [
    ['hse-overview', '/functions/hse'],
    ['hse-incidents', '/functions/hse/incidents'],
    ['hse-hazards', '/functions/hse/hazards'],
    ['hse-certificates', '/functions/hse/certificates'],
  ]),
];

export const workbenchChecks: readonly AccessCheck[] = [
  ...workbenchModules.flatMap((item) =>
    item.landing.map((entry) => page(entry.pageId)),
  ),
  page('procurement-review-settings'),
  page('requisitions-review-settings'),
  page('sales-review-settings'),
  page('warehouse-review-settings'),
];

/** The four cards on the home page. */
export const homeModules: readonly HomeModule[] = [
  {
    id: 'organization',
    titleKey: 'erp.organization',
    descriptionKey: 'erp.organizationDescription',
    icon: Network,
    path: '/organization',
    checks: [{ type: 'settings', id: 'organization', action: 'read' }],
  },
  {
    id: 'hr',
    titleKey: 'erp.hr',
    descriptionKey: 'erp.hrDescription',
    icon: Users,
    path: '/human-resources',
    checks: [page('people-overview')],
  },
  {
    id: 'functions',
    titleKey: 'erp.functions',
    descriptionKey: 'erp.functionsDescription',
    icon: PanelsTopLeft,
    path: '/functions',
    checks: workbenchChecks,
    any: true,
  },
  {
    id: 'development',
    titleKey: 'erp.development',
    descriptionKey: 'erp.developmentDescription',
    icon: Building2,
    path: null,
    checks: [],
  },
];

export const homeChecks: readonly AccessCheck[] = homeModules.flatMap(
  (item) => item.checks,
);

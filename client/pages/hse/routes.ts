import {
  Award,
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import type { AppClientRouteDefinition } from '@nocobase/app-client/plugins';

const pageAuthz = (id: string) =>
  ({ resource: { type: 'page', id }, action: 'access' }) as const;

export const hseRoutes: AppClientRouteDefinition[] = [
  {
    name: 'hse',
    navigation: { title: 'hse.title', icon: ShieldCheck, order: 60 },
    children: [
      {
        name: 'hse-overview',
        path: '/functions/hse',
        companyScope: 'hse/companies',
        auth: 'required',
        authz: pageAuthz('hse-overview'),
        navigation: { title: 'hse.overview', icon: LayoutDashboard },
        componentLoader: () => import('./overview.js'),
      },
      {
        name: 'hse-incidents',
        path: '/functions/hse/incidents',
        companyScope: 'hse/companies',
        auth: 'required',
        authz: pageAuthz('hse-incidents'),
        navigation: { title: 'hse.incidents', icon: TriangleAlert },
        componentLoader: () => import('./incidents.js'),
      },
      {
        name: 'hse-hazards',
        path: '/functions/hse/hazards',
        companyScope: 'hse/companies',
        auth: 'required',
        authz: pageAuthz('hse-hazards'),
        navigation: { title: 'hse.hazards', icon: ClipboardList },
        componentLoader: () => import('./hazards.js'),
      },
      {
        name: 'hse-certificates',
        path: '/functions/hse/certificates',
        companyScope: 'hse/companies',
        auth: 'required',
        authz: pageAuthz('hse-certificates'),
        navigation: { title: 'hse.certificates', icon: Award },
        componentLoader: () => import('./certificates.js'),
      },
      {
        name: 'hse-inspections',
        path: '/functions/hse/inspections',
        companyScope: 'hse/companies',
        auth: 'required',
        authz: pageAuthz('hse-inspections'),
        navigation: { title: 'hse.inspections', icon: ClipboardCheck },
        componentLoader: () => import('./inspections.js'),
      },
      {
        name: 'hse-work-permits',
        path: '/functions/hse/work-permits',
        companyScope: 'hse/companies',
        auth: 'required',
        authz: pageAuthz('hse-work-permits'),
        navigation: { title: 'hse.workPermits', icon: FileCheck2 },
        componentLoader: () => import('./work-permits.js'),
      },
      {
        name: 'hse-training-records',
        path: '/functions/hse/training-records',
        companyScope: 'hse/companies',
        auth: 'required',
        authz: pageAuthz('hse-training-records'),
        navigation: { title: 'hse.trainingRecords', icon: GraduationCap },
        componentLoader: () => import('./training-records.js'),
      },
      {
        name: 'hse-actions',
        path: '/functions/hse/actions',
        companyScope: 'hse/companies',
        auth: 'required',
        authz: pageAuthz('hse-actions'),
        navigation: { title: 'hse.actions', icon: ListChecks },
        componentLoader: () => import('./actions.js'),
      },
    ],
  },
];

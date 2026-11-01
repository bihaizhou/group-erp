import {
  CalendarClock,
  CalendarDays,
  Clock3,
  ClipboardCheck,
  Factory,
  FileText,
  Settings2,
  TimerOff,
  Wrench,
  LayoutDashboard,
} from 'lucide-react';
import type { AppClientRouteDefinition } from '@nocobase/app-client/plugins';

const pageAuthz = (id: string) =>
  ({ resource: { type: 'page', id }, action: 'access' }) as const;

export const productionRoutes: AppClientRouteDefinition[] = [
  {
    name: 'production',
    navigation: { title: 'production.title', icon: Factory, order: 55 },
    children: [
      {
        name: 'production-overview',
        path: '/functions/production/overview',
        auth: 'required',
        authz: pageAuthz('production-overview'),
        companyScope: 'production/companies',
        navigation: { title: 'dashboard.menu', icon: LayoutDashboard },
        componentLoader: () => import('./overview.js'),
      },
      {
        name: 'production-daily',
        path: '/functions/production/daily',
        auth: 'required',
        authz: pageAuthz('production-daily'),
        companyScope: 'production/companies',
        navigation: { title: 'production.daily', icon: ClipboardCheck },
        componentLoader: () => import('./daily.js'),
      },
      {
        name: 'production-schedules',
        path: '/functions/production/schedules',
        auth: 'required',
        authz: pageAuthz('production-schedules'),
        navigation: { title: 'production.schedules', icon: CalendarDays },
        componentLoader: () => import('./schedules.js'),
      },
      {
        name: 'production-attendance',
        path: '/functions/production/attendance',
        auth: 'required',
        authz: pageAuthz('production-attendance'),
        navigation: { title: 'production.attendance', icon: ClipboardCheck },
        componentLoader: () => import('./attendance.js'),
      },
      {
        name: 'production-shift-reports',
        path: '/functions/production/shift-reports',
        auth: 'required',
        authz: pageAuthz('production-shift-reports'),
        navigation: { title: 'production.shiftReports', icon: FileText },
        componentLoader: () => import('./shift-reports.js'),
      },
      {
        name: 'production-equipment',
        path: '/functions/production/equipment',
        auth: 'required',
        authz: pageAuthz('production-equipment'),
        navigation: { title: 'production.equipment', icon: Wrench },
        componentLoader: () => import('./equipment.js'),
      },
      {
        name: 'production-maintenance-plans',
        path: '/functions/production/maintenance-plans',
        auth: 'required',
        authz: pageAuthz('production-maintenance-plans'),
        navigation: {
          title: 'production.maintenancePlans',
          icon: CalendarClock,
        },
        componentLoader: () => import('./maintenance-plans.js'),
      },
      {
        name: 'production-downtime',
        path: '/functions/production/downtime',
        auth: 'required',
        authz: pageAuthz('production-downtime'),
        navigation: { title: 'production.downtimeTitle', icon: TimerOff },
        componentLoader: () => import('./downtime.js'),
      },
      {
        name: 'production-overtime',
        path: '/functions/production/overtime',
        auth: 'required',
        authz: pageAuthz('production-overtime'),
        navigation: { title: 'production.overtime', icon: Clock3 },
        componentLoader: () => import('./overtime.js'),
      },
      {
        name: 'production-setup',
        path: '/functions/production/setup',
        auth: 'required',
        authz: pageAuthz('production-setup'),
        navigation: { title: 'production.setup', icon: Settings2 },
        componentLoader: () => import('./setup.js'),
      },
    ],
  },
];

import { it } from 'vitest';
import {
  resolveAppClientContributions,
  type AppClientRegisteredRoute,
} from '@nocobase/app-client/plugins';
import applicationRoutes from '../../client/routes.js';
import { pageFieldVisibilityPageKeys } from '../../client/pages/settings/page-field-visibility-pages.js';
import { canonicalPageKey } from '../../client/pages/settings/page-keys.js';

const application = resolveAppClientContributions([
  { packageName: 'inert', source: 'application', routes: applicationRoutes },
]);
const flatten = (routes: readonly AppClientRegisteredRoute[]): AppClientRegisteredRoute[] =>
  routes.flatMap((route) => [route, ...flatten(route.children ?? [])]);
const isSettings = (r: AppClientRegisteredRoute) =>
  r.source === 'application' && ['settings', 'systemManagement'].includes(r.name);
const pages = flatten(application.routes).filter(
  (r) =>
    r.componentLoader &&
    r.auth === 'required' &&
    typeof r.authz === 'object' &&
    r.authz.resource.type === 'page' &&
    !isSettings(r),
);
it('audit', () => {
  const keys = [...new Set(pages.map((p) => canonicalPageKey(p.name)))];
  const missing = keys.filter((k) => !pageFieldVisibilityPageKeys.has(k));
  const groups: Record<string, string[]> = {};
  for (const k of missing) {
    const g = k.split('-').slice(0, 2).join('-');
    (groups[g] ??= []).push(k);
  }
  console.log('total', keys.length, 'missing', missing.length);
  for (const [g, list] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length))
    console.log(g, list.length, list.slice(0, 5).join(' '));
});

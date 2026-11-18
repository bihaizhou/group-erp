import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveAppClientContributions } from '@nocobase/app-client/plugins';
import applicationRoutes from '../../client/routes.js';
import { pagePermissionResources } from '../../client/pages/settings/page-permissions.js';
import { pagePermissionTitles } from '../../client/pages/settings/page-permission-titles.js';

const catalogPath = fileURLToPath(
  new URL('../../database/main/permissions/page-catalog.ts', import.meta.url),
);

const application = resolveAppClientContributions([
  {
    packageName: 'page-catalog-app',
    source: 'application',
    routes: applicationRoutes,
  },
]);

const header = `/**
 * Page permission ids, generated from the client route tree.
 *
 * These are the only \`{ type: 'page', id }\` resources a permission set may
 * grant. The server rejects sets that grant anything else, so a page merge or
 * rename can no longer leave a silently dead grant behind.
 *
 * Regenerate after adding, merging or renaming a page:
 *   UPDATE_PAGE_CATALOG=1 pnpm exec vitest run tests/client/page-catalog.test.ts
 *
 * The same test fails whenever this file is stale, so CI catches route edits
 * that forgot to regenerate it.
 */`;

const generated = (): string => {
  const ids = pagePermissionResources(
    application.routes,
    pagePermissionTitles,
    (path) => path,
  )
    .map((resource) => resource.id)
    .sort();
  return [
    header,
    'export const PAGE_IDS: readonly string[] = [',
    ...ids.map((id) => `  '${id}',`),
    '] as const;',
    '',
    'export const PAGE_ID_SET: ReadonlySet<string> = new Set(PAGE_IDS);',
    '',
  ].join('\n');
};

describe('generated page catalog', () => {
  it('matches the client route tree', () => {
    if (process.env.UPDATE_PAGE_CATALOG === '1') {
      writeFileSync(catalogPath, generated());
    }
    expect(
      readFileSync(catalogPath, 'utf8'),
      'database/main/permissions/page-catalog.ts is stale; run UPDATE_PAGE_CATALOG=1 pnpm exec vitest run tests/client/page-catalog.test.ts',
    ).toBe(generated());
  });

  it('contains every business page exactly once', () => {
    const ids = generated()
      .split('\n')
      .filter((line) => line.startsWith("  '"))
      .map((line) => line.replace(/[ ',]/g, ''));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(70);
  });
});

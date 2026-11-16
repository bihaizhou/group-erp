import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveAppClientContributions } from '@nocobase/app-client/plugins';
import applicationRoutes from '../../client/routes.js';
import {
  fieldResourcesForPage,
  pageFieldResources,
} from '../../client/pages/settings/field-permission-pages.js';
import { pagePermissionResources } from '../../client/pages/settings/page-permissions.js';
import { pagePermissionTitles } from '../../client/pages/settings/page-permission-titles.js';
import {
  FIELD_CATALOG_RESOURCES,
  fieldCatalog,
} from '../../server/providers/field-catalog.js';

const application = resolveAppClientContributions([
  {
    packageName: 'page-field-coverage-app',
    source: 'application',
    routes: applicationRoutes,
  },
]);
const pages = pagePermissionResources(
  application.routes,
  pagePermissionTitles,
  (path) => path,
);
const pageIds = new Set(pages.map((page) => page.id));
const collection = (name: string) => {
  const file = `database/main/collections/${name}/collection.json`;
  return JSON.parse(readFileSync(file, 'utf8')).collection.fields as {
    name: string;
    type?: string;
    title?: string;
  }[];
};
const database = {
  collections: () => ({
    get: async (name: string) => ({ fields: collection(name) }),
  }),
} as never;

describe('every page and every field is reachable from permission management', () => {
  it('maps every page permission to at least one field resource', () => {
    const unmapped = pages
      .filter((page) => fieldResourcesForPage(page.id).length === 0)
      .map((page) => page.id);
    expect(
      unmapped,
      '新增页面必须在 field-permission-pages.ts 登记字段资源，否则页面权限里没有字段入口。',
    ).toEqual([]);
  });

  it('has no stale page or resource mapping', () => {
    const stalePages = Object.keys(pageFieldResources).filter(
      (pageId) => !pageIds.has(pageId),
    );
    const catalog = new Set(
      FIELD_CATALOG_RESOURCES.map(({ resource }) => resource),
    );
    const unknownResources = [
      ...new Set(Object.values(pageFieldResources).flat()),
    ].filter((resource) => !catalog.has(resource));
    const unusedResources = [...catalog].filter(
      (resource) =>
        !Object.values(pageFieldResources).some((resources) =>
          resources.includes(resource),
        ),
    );
    expect(stalePages, '字段映射里的页面已不存在，需删除。').toEqual([]);
    expect(unknownResources, '页面引用了不存在的字段目录资源。').toEqual([]);
    expect(
      unusedResources,
      '字段目录资源必须至少被一个页面引用，否则用户永远看不到它。',
    ).toEqual([]);
  });

  it('does not repeat a resource on one page', () => {
    const repeated = Object.entries(pageFieldResources)
      .filter(([, resources]) => new Set(resources).size !== resources.length)
      .map(([pageId]) => pageId);
    expect(repeated).toEqual([]);
  });

  it('offers every collection column, including newly migrated untitled ones', async () => {
    const catalog = await fieldCatalog(database);
    const byResource = new Map(catalog.map((entry) => [entry.resource, entry]));
    const missing: string[] = [];
    for (const resource of FIELD_CATALOG_RESOURCES) {
      const entry = byResource.get(resource.resource);
      expect(entry, `目录缺少资源 ${resource.resource}`).toBeDefined();
      const names = new Set(entry!.fields.map(({ field }) => field));
      expect(
        new Set(entry!.fields.map(({ field }) => field)).size,
        `${resource.resource} 有重复字段`,
      ).toBe(entry!.fields.length);
      if (resource.manual?.length) {
        for (const field of resource.manual) {
          if (!names.has(field.field))
            missing.push(`${resource.resource}.${field.field}`);
        }
        continue;
      }
      for (const field of resource.only ?? []) {
        if (!names.has(field)) missing.push(`${resource.resource}.${field}`);
      }
      if (resource.complete && resource.collection) {
        const excluded = new Set(resource.exclude ?? []);
        for (const field of collection(resource.collection)) {
          if (
            !/^(id|createdBy|updatedBy|createdAt|updatedAt|version|revision|deletedAt)$/.test(
              field.name,
            ) &&
            !excluded.has(field.name) &&
            !names.has(field.name)
          ) {
            missing.push(`${resource.resource}.${field.name}`);
          }
        }
      }
    }
    expect(
      missing,
      '字段目录必须覆盖集合里的每一个内容字段；新增列若不属于业务字段，请加入 exclude。',
    ).toEqual([]);
  });

  it('keeps every curated field pointing at a real collection column', () => {
    const bad: string[] = [];
    for (const resource of FIELD_CATALOG_RESOURCES) {
      if (!resource.collection) continue;
      const fields = new Set(
        collection(resource.collection).map(({ name }) => name),
      );
      for (const field of resource.only ?? []) {
        if (!fields.has(field)) bad.push(`${resource.resource}.${field}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

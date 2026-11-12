import { describe, expect, it } from 'vitest';
import {
  fieldResourcesForPage,
  pageFieldResources,
  pageIdFromPermissionRow,
  pagesForFieldResource,
} from '../../client/pages/settings/field-permission-pages.js';

describe('field permission page ownership', () => {
  it('gives each page only the field resources it actually renders', () => {
    expect(fieldResourcesForPage('production-report')).toEqual([
      'production.report.material',
    ]);
    expect(fieldResourcesForPage('procurement-suppliers')).toEqual([
      'procurement.supplier.identity',
    ]);
    expect(fieldResourcesForPage('people-employees')).toEqual([
      'people.employee.contact',
      'people.employee.grade',
    ]);
    expect(fieldResourcesForPage('warehouse-inventory')).toEqual([
      'warehouse.inventory.balance',
    ]);
    expect(fieldResourcesForPage('settings-roles')).toEqual([]);
    expect(fieldResourcesForPage(undefined)).toEqual([]);
  });

  it('finds every page sharing one resource in navigation order', () => {
    expect(pagesForFieldResource('execution.document.line')).toEqual([
      'procurement-orders',
      'sales-orders',
      'warehouse-inbounds',
      'warehouse-outbounds',
      'warehouse-transfers',
      'warehouse-counts',
    ]);
    expect(pagesForFieldResource('people.employee.grade')).toEqual([
      'people-employees',
      'people-profiles',
    ]);
    expect(pagesForFieldResource('unknown.resource')).toEqual([]);
  });

  it('reads a page id from page-access rows only', () => {
    expect(
      pageIdFromPermissionRow('["page","production-report","access"]'),
    ).toBe('production-report');
    expect(
      pageIdFromPermissionRow('["action","production-report","access"]'),
    ).toBeUndefined();
    expect(
      pageIdFromPermissionRow('["page","production-report","create"]'),
    ).toBeUndefined();
    expect(pageIdFromPermissionRow('["page",42,"access"]')).toBeUndefined();
    expect(
      pageIdFromPermissionRow('["page","production-report"]'),
    ).toBeUndefined();
    expect(pageIdFromPermissionRow('not json')).toBeUndefined();
    expect(pageIdFromPermissionRow(undefined)).toBeUndefined();
  });

  it('keeps every mapped page non-empty without duplicate resources', () => {
    for (const [pageId, resources] of Object.entries(pageFieldResources)) {
      expect(pageId).not.toBe('');
      expect(resources.length).toBeGreaterThan(0);
      expect(new Set(resources).size).toBe(resources.length);
    }
  });
});

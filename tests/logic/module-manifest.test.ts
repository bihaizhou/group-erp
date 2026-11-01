import { describe, expect, it } from 'vitest';
import {
  functionModules,
  functionModuleRoutes,
} from '../../client/module-manifest.js';

describe('function module manifest', () => {
  it('registers every business module exactly once', () => {
    const ids = functionModules.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'warehouse',
      'procurement',
      'requisitions',
      'sales',
      'hse',
      'production',
      'operations',
      'assets',
    ]);
  });

  it('expands the manifest into the signed-in route tree', () => {
    expect(functionModuleRoutes).toHaveLength(
      functionModules.reduce(
        (total, module) => total + module.routes.length,
        0,
      ),
    );
    for (const route of functionModuleRoutes) {
      expect(route.name).toBeTruthy();
      if (!route.path?.startsWith('/')) continue;
      expect(route.auth).toBe('required');
      expect(route.authz).toBeTruthy();
    }
  });
});

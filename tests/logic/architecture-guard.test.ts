import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)));
}

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

const pages = walk('client/pages');

function offenders(pattern: RegExp, files = pages): string[] {
  return files
    .filter((file) => pattern.test(read(file)))
    .map((file) => relative(root, file));
}

describe('ERP structure guardrails', () => {
  test('keeps one review-rule editor instead of copying the condition table', () => {
    expect(offenders(/conditionIds|localRefs/)).toEqual([]);
    expect(read('client/pages/review-settings/runtime.tsx')).toContain(
      'ReviewRuleEditor',
    );
    expect(read('client/pages/execution/settings-edit.tsx')).toContain(
      'ReviewSettingsPanel',
    );
    for (const file of [
      'client/pages/review-settings/purchase-panel.tsx',
      'client/pages/review-settings/issue-panel.tsx',
    ]) {
      const source = read(file);
      expect(source).toContain('ReviewSettingsPanel');
      expect(source).not.toContain('ReviewRuleEditor');
    }
  });

  test('does not copy the company gate into individual pages', () => {
    // The operations issue filter legitimately offers an empty company option.
    const allowed = new Set(['client/pages/operations/issues.tsx']);
    expect(
      offenders(/t\([^)]*\.(?:selectCompany|chooseCompany)[^)]*\)/).filter(
        (file) => !allowed.has(file),
      ),
    ).toEqual([]);
  });

  test('keeps company gating at the route boundary, not in pages', () => {
    expect(offenders(/CompanyScope|useOnlyCompany|useDefaultCompany/)).toEqual(
      [],
    );
    expect(read('client/routing/client-route.tsx')).toContain('CompanyGate');
    // Scope is declared on the route and collected from the route tree; do not
    // reintroduce a second global path table.
    expect(offenders(/COMPANY_SCOPED_PATHS|companyScopeEndpoint/)).toEqual([]);
    expect(read('client/company/route-scopes.ts')).toContain(
      'route.companyScope',
    );
    // The account's home company is resolved once by the gate; pages must not
    // query it themselves or treat it as an authorisation.
    expect(offenders(/useAccountCompanyId/)).toEqual([]);
    expect(read('client/company/company-gate.tsx')).toContain(
      'useAccountCompanyId',
    );
  });

  test('does not render permission denial as a bare paragraph', () => {
    // An inline error alert inside organization pages is not a page-level gate.
    const allowed = new Set(['client/pages/organization/shared.tsx']);
    expect(
      offenders(/<p[^>]*>[\s\S]{0,200}?forbidden[\s\S]{0,80}?<\/p>/).filter(
        (file) => !allowed.has(file),
      ),
    ).toEqual([]);
  });

  test('keeps one approval settings entry per business module', () => {
    for (const [file, title] of [
      ['client/pages/suppliers/routes.ts', 'reviewSettings.procurement'],
      ['client/pages/requisitions/routes.ts', 'reviewSettings.requisitions'],
      ['client/pages/execution/routes.ts', 'reviewSettings.sales'],
      ['client/pages/execution/routes.ts', 'reviewSettings.warehouse'],
    ] as const) {
      expect(read(file)).toContain(`title: '${title}'`);
    }
    expect(read('client/module-manifest.ts')).not.toContain('review-settings');
  });

  test('renders review history through the shared audit component', () => {
    for (const file of [
      'client/pages/procurement/requests/detail/index.tsx',
      'client/pages/requisitions/requests/detail/index.tsx',
    ]) {
      const source = read(file);
      expect(source).toContain("from '#components/review-audit'");
      expect(source).not.toMatch(/reviewTasks\s*\n\s*\.filter/);
    }
  });

  test('drives home and workbench cards from the shared catalog', () => {
    for (const [file, source] of [
      ['client/pages/home/index.tsx', 'homeModules'],
      ['client/pages/materials/workbench.tsx', 'workbenchModules'],
    ] as const) {
      const body = read(file);
      expect(body).toContain(source);
      expect(body).not.toContain('useCan');
    }
    const catalog = read('client/modules/catalog.ts');
    expect(catalog).toContain('workbenchModules');
    expect(catalog).toContain('homeModules');
  });

  test('does not recreate a central review settings page', () => {
    expect(pages).not.toContain('client/pages/review-settings/index.tsx');
    expect(pages).not.toContain('client/pages/review-settings/routes.ts');
    expect(read('client/routes.ts')).not.toContain(
      '/functions/review-settings',
    );
  });

  test('gives every module settings page its own page grant', () => {
    for (const [file, page] of [
      ['client/pages/suppliers/routes.ts', 'procurement-review-settings'],
      ['client/pages/requisitions/routes.ts', 'requisitions-review-settings'],
      ['client/pages/execution/routes.ts', 'sales-review-settings'],
      ['client/pages/execution/routes.ts', 'warehouse-review-settings'],
    ] as const) {
      expect(read(file)).toContain(`id: '${page}'`);
    }
    for (const file of [
      'client/pages/suppliers/routes.ts',
      'client/pages/requisitions/routes.ts',
      'client/pages/execution/routes.ts',
    ])
      expect(read(file)).not.toContain("id: 'review-settings'");
  });

  test('describes review fields on the server without leaking parser functions', () => {
    const helper = read('server/providers/review-rule-fields.ts');
    expect(helper).toMatch(/\.describe\(/);
    expect(helper).not.toMatch(/\bparse\b/);
  });
});

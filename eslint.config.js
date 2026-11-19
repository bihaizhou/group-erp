import { createApplicationConfig } from '@nocobase/dev-config/eslint';

const config = createApplicationConfig({
  tsconfigRootDir: import.meta.dirname,
  ignores: [
    '.extension-state/**',
    'client-old/**',
    'public/r/**',
    'storage/**',
    'dist/**',
    // 本地预览副本与 UX 审查产物是构建输出，不是源码；扫描它们会让
    // eslint 读入数万个生成文件，内存和耗时都会失控。
    '.preview/**',
    '.ux-audit/**',
    '.tools/**',
    // Internal workspace packages own their lint and TypeScript configurations.
    'packages/**',
  ],
});

export default [
  ...config,
  {
    // Seed contexts expose repository as a method on the object passed in;
    // destructuring it is the documented call style in this repository.
    files: ['database/**/seeds/*.ts'],
    rules: { '@typescript-eslint/unbound-method': 'off' },
  },
  {
    // Published migrations are frozen once released (AGENTS.md) and seeds are
    // one-shot data scripts. Both read loosely typed repository rows and
    // deliberately coerce values with String()/casts, so the type-aware rules
    // are relaxed here instead of rewriting history that is already installed.
    files: ['database/main/migrations/**', 'database/main/seeds/**'],
    rules: {
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // Vitest's expect(value, message) accepts a failure message; the plugin's
    // Jest-era default of one argument rejects that valid form.
    files: ['tests/**/*.{ts,tsx}'],
    rules: { 'vitest/valid-expect': ['error', { maxArgs: 2 }] },
  },
];

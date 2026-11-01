import { createApplicationConfig } from '@nocobase/dev-config/eslint';

const config = createApplicationConfig({
  tsconfigRootDir: import.meta.dirname,
  ignores: [
    '.extension-state/**',
    'client-old/**',
    'public/r/**',
    'storage/**',
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
];

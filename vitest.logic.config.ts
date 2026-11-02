import { createNodeVitestConfig } from '@nocobase/dev-config/vitest/node';

export default createNodeVitestConfig({
  test: {
    include: ['tests/logic/**/*.test.ts'],
    fileParallelism: false,
  },
});

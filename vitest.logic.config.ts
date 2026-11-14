import { createNodeVitestConfig } from '@nocobase/dev-config/vitest/node';

export default createNodeVitestConfig({
  test: {
    include: ['tests/logic/**/*.test.ts'],
    fileParallelism: false,
    // Tests that opt into jsdom still need Storage and matchMedia, which this
    // toolchain's jsdom build does not implement.
    setupFiles: ['./tests/setup/dom-globals.ts'],
  },
});

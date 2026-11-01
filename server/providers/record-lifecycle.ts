import type { LifecycleRuntime } from '@nocobase/lifecycle';
import { createServiceToken } from '@nocobase/service-provider';

// Personnel and material governance share one runtime, transition store and dispatcher.
export const recordLifecycleToken = createServiceToken<LifecycleRuntime>(
  'group-erp/record-lifecycle',
);

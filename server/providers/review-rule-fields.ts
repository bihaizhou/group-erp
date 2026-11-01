import type { LifecycleRuntime } from '@nocobase/lifecycle';

export interface ReviewRuleFieldDescription {
  key: string;
  type: 'reviewers' | 'boolean';
  title: string;
}

const configurable = new Set(['reviewers', 'boolean']);

/** The administrator-facing fields of one lifecycle parameter group, without server-side parsing. */
export function reviewRuleFields(
  runtime: LifecycleRuntime,
  lifecycle: string,
  groupKey: string,
  exclude: readonly string[] = [],
): ReviewRuleFieldDescription[] {
  const group = runtime
    .describe(lifecycle)
    .parameterConfiguration?.groups.find((item) => item.key === groupKey);
  if (!group) return [];
  return Object.entries(group.fields).flatMap(([key, field]) =>
    configurable.has(field.type) && !exclude.includes(key)
      ? [
          {
            key,
            type: field.type as 'reviewers' | 'boolean',
            title: field.title,
          },
        ]
      : [],
  );
}

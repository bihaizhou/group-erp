import type { FilterBuilder, FilterNode } from '@nocobase/db';

// Keep large authorized ID sets below SQL expression-depth limits without
// truncating them or silently weakening the scope.
export function materialIdFilter(
  f: FilterBuilder,
  field: string,
  ids: readonly string[],
): FilterNode {
  if (!ids.length) return f.string(field).eq('__none__');
  if (ids.length <= 100) return f.or(ids.map((id) => f.string(field).eq(id)));
  const middle = Math.floor(ids.length / 2);
  return f.or([
    materialIdFilter(f, field, ids.slice(0, middle)),
    materialIdFilter(f, field, ids.slice(middle)),
  ]);
}

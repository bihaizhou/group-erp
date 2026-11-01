import type { Draft, InputLine } from './model.js';
import { same } from './model.js';
import { randomUuid } from '#lib/random-id';
export interface DraftConflict {
  key: string;
  field: string;
  local: unknown;
  latest: unknown;
  retired?: boolean;
}
/** Three-way application form merge; applying choices never submits a request. */
export function compareDraft(base: Draft, local: Draft, latest: Draft) {
  const merged = structuredClone(latest),
    conflicts: DraftConflict[] = [];
  const choose = (
    key: string,
    field: string,
    before: unknown,
    mine: unknown,
    current: unknown,
    retired = false,
  ): unknown => {
    if (same(before, mine)) return current;
    if (!retired && (same(before, current) || same(mine, current))) return mine;
    conflicts.push({ key, field, local: mine, latest: current, retired });
    return current;
  };
  for (const field of Object.keys(base).filter(
    (key) => key !== 'lines',
  ) as (keyof Omit<Draft, 'lines'>)[])
    Object.assign(merged, {
      [field]: choose(
        `head:${field}`,
        field,
        base[field],
        local[field],
        latest[field],
      ),
    });
  const b = new Map(base.lines.map((line) => [line.id, line])),
    l = new Map(local.lines.map((line) => [line.id, line])),
    r = new Map(latest.lines.map((line) => [line.id, line])),
    ids = [...new Set([...b.keys(), ...l.keys(), ...r.keys()])],
    lines = new Map<string, InputLine>();
  for (const id of ids) {
    const value = choose(
      `line:${id}`,
      'lines',
      b.get(id),
      l.get(id),
      r.get(id),
      b.has(id) && !r.has(id) && l.has(id),
    );
    if (value) lines.set(id, value as InputLine);
  }
  const order = choose(
    'order',
    'lineOrder',
    [...b.keys()],
    [...l.keys()],
    [...r.keys()],
  ) as string[];
  merged.lines = [...new Set([...order, ...lines.keys()])].flatMap((id) =>
    lines.has(id) ? [lines.get(id)!] : [],
  );
  return { merged, conflicts };
}
export function applyDraftMerge(
  comparison: ReturnType<typeof compareDraft>,
  choices: Record<string, 'local' | 'latest'>,
) {
  const merged = structuredClone(comparison.merged);
  let order: string[] | undefined;
  for (const conflict of comparison.conflicts) {
    if (!choices[conflict.key]) throw new Error('Unresolved draft conflict');
    const value =
      choices[conflict.key] === 'local' ? conflict.local : conflict.latest;
    if (conflict.key.startsWith('head:'))
      Object.assign(merged, { [conflict.key.slice(5)]: value });
    else if (conflict.key === 'order') order = value as string[];
    else {
      const id = conflict.key.slice(5);
      merged.lines = merged.lines.filter((line) => line.id !== id);
      if (value) {
        const line = structuredClone(value) as InputLine;
        if (conflict.retired && choices[conflict.key] === 'local')
          line.id = randomUuid();
        merged.lines.push(line);
      }
    }
  }
  if (order) {
    const rank = new Map(order.map((id, index) => [id, index]));
    merged.lines.sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }
  return merged;
}

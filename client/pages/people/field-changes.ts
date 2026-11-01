import {
  fields,
  type Data,
  type FieldSpec,
  type Kind,
  type Value,
} from './model.js';

const ignored = new Set([
  'id',
  'revision',
  'lifecycleVersion',
  'createdBy',
  'createdAt',
  'updatedAt',
  'snapshot',
  'photoId',
  'accountId',
]);
const common: Record<string, FieldSpec> = {
  name: { key: 'name' },
  code: { key: 'code' },
  status: { key: 'status' },
  subjectId: { key: 'subjectId', source: 'orgSubjects' },
  personId: { key: 'personId', source: 'employees' },
  positionId: { key: 'positionId', source: 'orgPositions' },
};

export type FieldChange = {
  key: string;
  field: FieldSpec;
  before: Value;
  after: Value;
};

const topLevel = new Set([
  'name',
  'code',
  'status',
  'subjectId',
  'personId',
  'positionId',
]);

function read(row: Data | null | undefined, key: string): Value {
  if (!row) return null;
  if (topLevel.has(key)) return row[key] ?? null;
  const data = row.data;
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data[key] ?? null)
    : null;
}
export function isEmpty(value: Value | undefined): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && !value.length)
  );
}
function same(left: Value, right: Value): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((value, index) => same(value, right[index]))
    );
  if (
    left &&
    right &&
    typeof left === 'object' &&
    typeof right === 'object' &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => key in right && same(left[key], right[key]))
    );
  }
  return false;
}

/**
 * The field-level difference between two audit snapshots. Each audit row stores the whole record before and after the
 * operation, so this is what makes the change readable instead of showing the two JSON payloads.
 */
export function fieldChanges(
  kind: Kind,
  before: Data | null | undefined,
  after: Data | null | undefined,
): FieldChange[] {
  if (!before) return [];
  const specs = new Map<string, FieldSpec>();
  for (const field of fields[kind]) specs.set(field.key, field);
  for (const [key, field] of Object.entries(common))
    if (!specs.has(key)) specs.set(key, field);
  for (const row of [before, after]) {
    const data = row?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    for (const key of Object.keys(data))
      if (!specs.has(key) && !ignored.has(key)) specs.set(key, { key });
  }
  const changes: FieldChange[] = [];
  for (const [key, field] of specs) {
    if (ignored.has(key)) continue;
    const previous = read(before, key);
    const next = read(after, key);
    if (isEmpty(previous) && isEmpty(next)) continue;
    if (same(previous, next)) continue;
    changes.push({ key, field, before: previous, after: next });
  }
  return changes;
}

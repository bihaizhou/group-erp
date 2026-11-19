export interface PermissionSetOption {
  readonly key: string;
  readonly title: string;
  readonly pageCount: number;
  readonly actionCount: number;
}

export interface PositionSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly unitName: string;
  readonly permissionSetKeys: readonly string[];
  readonly memberCount: number;
  readonly templateId: string;
  readonly templateName: string;
  readonly templateKeys: readonly string[];
}

export interface TemplateSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly permissionSetKeys: readonly string[];
  readonly positionCount: number;
}

export type PermissionModuleId =
  | 'organization'
  | 'people'
  | 'materials'
  | 'procurement'
  | 'requisitions'
  | 'warehouse'
  | 'sales'
  | 'production'
  | 'hse'
  | 'operations'
  | 'assets'
  | 'execution'
  | 'system'
  | 'other';

export interface PermissionSetGroup {
  readonly id: PermissionModuleId;
  readonly sets: readonly PermissionSetOption[];
}

/**
 * Permission sets are stored under stable business keys. Grouping by those
 * prefixes puts each set under the module an administrator thinks in, without
 * maintaining a per-set allowlist that would silently misgroup new sets.
 * Longest prefix wins, so `human-resources` is not read as `human`.
 */
const MODULE_PREFIXES: readonly (readonly [string, PermissionModuleId])[] = [
  ['human-resources', 'people'],
  ['organization', 'organization'],
  ['procurement', 'procurement'],
  ['requisitions', 'requisitions'],
  ['administrator', 'system'],
  ['warehouse', 'warehouse'],
  ['production', 'production'],
  ['operations', 'operations'],
  ['personnel', 'people'],
  ['materials', 'materials'],
  ['execution', 'execution'],
  ['company', 'people'],
  ['people', 'people'],
  ['system', 'system'],
  ['sales', 'sales'],
  ['asset', 'assets'],
  ['hse', 'hse'],
];

const MODULE_ORDER: readonly PermissionModuleId[] = [
  'organization',
  'people',
  'materials',
  'procurement',
  'requisitions',
  'warehouse',
  'sales',
  'production',
  'hse',
  'operations',
  'assets',
  'execution',
  'system',
  'other',
];

export function permissionSetModule(key: string): PermissionModuleId {
  for (const [prefix, module] of MODULE_PREFIXES) {
    if (key === prefix || key.startsWith(`${prefix}-`)) return module;
  }
  return 'other';
}

export function moduleLabelKey(module: PermissionModuleId): string {
  const suffix = module.charAt(0).toUpperCase() + module.slice(1);
  return `org.permissionModule${suffix}`;
}

export function groupPermissionSets(
  sets: readonly PermissionSetOption[],
): readonly PermissionSetGroup[] {
  const buckets = new Map<PermissionModuleId, PermissionSetOption[]>();
  for (const set of sets) {
    const module = permissionSetModule(set.key);
    const bucket = buckets.get(module) ?? [];
    bucket.push(set);
    buckets.set(module, bucket);
  }
  const groups: PermissionSetGroup[] = [];
  for (const id of MODULE_ORDER) {
    const bucket = buckets.get(id);
    if (!bucket?.length) continue;
    groups.push({
      id,
      sets: [...bucket].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN')),
    });
  }
  return groups;
}

export function effectivePermissionKeys(
  ownKeys: Iterable<string>,
  templateKeys: Iterable<string>,
): Set<string> {
  return new Set([...ownKeys, ...templateKeys]);
}

export interface PermissionKeyDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/** Compare the effective key sets so the save bar can state the real impact. */
export function permissionKeyDiff(
  before: Iterable<string>,
  after: Iterable<string>,
): PermissionKeyDiff {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: [...afterSet].filter((key) => !beforeSet.has(key)).sort(),
    removed: [...beforeSet].filter((key) => !afterSet.has(key)).sort(),
  };
}

/**
 * A set that reaches most of the application is almost never a position-level
 * grant. Flag it from the catalogue data instead of hard-coding set names.
 */
export function isBroadPermissionSet(
  set: Pick<PermissionSetOption, 'pageCount'>,
): boolean {
  return set.pageCount >= 30;
}

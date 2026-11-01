import type { OrgKind, OrgOptions } from './model.js';

const SEPARATOR = '-';

/**
 * The record whose code prefixes this record's code.
 *
 * Units are the only kind with two possible parents: a parent unit when one is
 * selected, otherwise the owning subject. Positions hang off their unit.
 * Relations connect two peers, so they do not inherit a code.
 */
function codeParent(
  kind: OrgKind,
  values: Record<string, string>,
): { kind: OrgKind; id: string } | undefined {
  if (kind === 'units') {
    if (values.parentId) return { kind: 'units', id: values.parentId };
    if (values.subjectId) return { kind: 'subjects', id: values.subjectId };
    return undefined;
  }
  if (kind === 'positions')
    return values.unitId ? { kind: 'units', id: values.unitId } : undefined;
  if (kind === 'subjects' || kind === 'sectors' || kind === 'regions')
    return values.parentId ? { kind, id: values.parentId } : undefined;
  return undefined;
}

/** The normalised parent code, or an empty string when the record has no parent. */
export function codePrefix(
  kind: OrgKind,
  values: Record<string, string>,
  options: OrgOptions,
): string {
  const parent = codeParent(kind, values);
  if (!parent) return '';
  const row = options[parent.kind]?.rows.find(({ id }) => id === parent.id);
  return row?.code ? String(row.code).trim().toUpperCase() : '';
}

/** A new record's code starts with `PARENT-`; the user types the local part after it. */
export function initialCode(
  kind: OrgKind,
  values: Record<string, string>,
  options: OrgOptions,
): string {
  const prefix = codePrefix(kind, values, options);
  return prefix ? `${prefix}${SEPARATOR}` : (values.code ?? '');
}

/**
 * Rewrites the parent part of an existing code when the parent changes, keeping
 * the local part. A legacy code that does not match the old prefix is treated
 * as a local code, so it gains the new prefix rather than losing its content.
 */
export function reparentCode(
  kind: OrgKind,
  before: Record<string, string>,
  after: Record<string, string>,
  options: OrgOptions,
): string | undefined {
  const previous = codePrefix(kind, before, options);
  const next = codePrefix(kind, after, options);
  if (previous === next) return undefined;
  const code = (before.code ?? '').trim();
  const marker = `${previous}${SEPARATOR}`;
  const local =
    previous && code.toUpperCase().startsWith(marker)
      ? code.slice(marker.length)
      : code;
  return next ? `${next}${SEPARATOR}${local}` : local;
}

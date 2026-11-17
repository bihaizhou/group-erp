import type { useTranslation } from 'react-i18next';

type TFunction = ReturnType<typeof useTranslation>['t'];

/**
 * A field name from the field-policy catalogue.
 *
 * `label` is the server-side fallback (usually the English collection column),
 * `titleKey` is the locale key generated from the schema. The key can lag
 * behind the locale dictionaries when a new column is added, which used to
 * leak English into the permission editor; `fieldLabel.<field>` is the shared
 * dictionary for generic columns and covers those gaps.
 */
export interface FieldLabelSource {
  readonly resource: string;
  readonly field: string;
  readonly label: string;
  readonly titleKey?: string | undefined;
}

const MISSING = '\u0000';

const warnedKeys = new Set<string>();

/**
 * Resolve a catalogue field name in the active language.
 *
 * This is the ONLY translation path for field permissions. It resolves, in
 * order: the schema titleKey, the shared `fieldLabel` dictionary keyed by the
 * column name, then the server label. A dev warning names the resource and
 * column whenever the last resort is used, so English labels surface while the
 * collection is being written instead of after release.
 *
 * The invariant is enforced by `tests/server/field-label-coverage.test.ts`,
 * which walks the real catalogue and fails if any field is missing from both
 * locale dictionaries.
 */
export function fieldLabelOf(source: FieldLabelSource, t: TFunction): string {
  const translated =
    (source.titleKey ? lookup(source.titleKey, t) : undefined) ??
    lookup(`fieldLabel.${source.field}`, t);
  if (translated) return translated;
  if (import.meta.env.DEV) {
    const key = `${source.resource}.${source.field}`;
    if (!warnedKeys.has(key)) {
      warnedKeys.add(key);
      console.warn(
        `[field-label] missing translation for ${key} (titleKey: ${source.titleKey ?? 'none'}, label: ${source.label})`,
      );
    }
  }
  return source.label;
}

function lookup(key: string, t: TFunction): string | undefined {
  const value = t(key, { defaultValue: MISSING });
  return value === MISSING || !value ? undefined : value;
}

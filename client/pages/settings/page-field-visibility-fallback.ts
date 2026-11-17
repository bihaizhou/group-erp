/**
 * Per the approved plan, create pages own the initial field settings and the
 * edit/detail/material-line pages start by copying the create page's settings
 * the first time they appear — after that every page keeps its own settings.
 * The UI never shows an "inherit/follow" concept: copying is just the initial
 * value. The rules intentionally stay dependency-free so the form hook can use
 * them without pulling the whole settings catalogue into every form bundle.
 *
 * Must stay in sync with `pageFieldVisibilityFallbackFor` in
 * server/providers/page-field-visibility.ts (the server enforces the same
 * initial-value mapping for pages without their own rows).
 */
export function pageFieldVisibilityInheritedFrom(
  pageKey: string | undefined,
): string | undefined {
  if (!pageKey) return undefined;
  let current = pageKey;
  const steps = [
    (key: string) => key.replace(/-detail-edit$/u, '-new'),
    (key: string) => key.replace(/-list-edit$/u, '-new'),
    (key: string) => key.replace(/-edit$/u, '-new'),
    (key: string) => key.replace(/-detail$/u, '-new'),
    // Material line pages live one hop below their host page.
    (key: string) => key.replace(/-materials$/u, ''),
    // Any page created under the create page (copy/action/version/…) starts
    // from the create page's settings.
    (key: string) =>
      key.includes('-new-') ? key.replace(/-new-.+$/u, '-new') : key,
  ];
  // A suffix can hide behind another one ('-list-edit-materials' strips to
  // '-list-edit' first), so repeat the steps until nothing changes.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const step of steps) {
      const next = step(current);
      if (next !== current) {
        current = next;
        changed = true;
        if (current.endsWith('-new')) return current;
      }
    }
    if (!changed) break;
  }
  return current === pageKey ? undefined : current;
}

/**
 * Edit pages default to the create page's field visibility. The suffix rules
 * intentionally stay dependency-free so the form hook can use them without
 * pulling the whole settings catalogue into every form bundle.
 */
export function pageFieldVisibilityInheritedFrom(
  pageKey: string | undefined,
): string | undefined {
  if (!pageKey || !pageKey.endsWith('-edit')) return undefined;
  const candidates = [
    pageKey.replace(/-list-edit$/u, '-new'),
    pageKey.replace(/-detail-edit$/u, '-new'),
    pageKey.replace(/-edit$/u, '-new'),
  ];
  return candidates.find((candidate) => candidate !== pageKey);
}

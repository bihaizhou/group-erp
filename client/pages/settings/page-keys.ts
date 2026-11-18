/**
 * Some records have two edit entries that render the same form: one opened
 * from the list (`-list-edit`, or plain `-edit` on older modules) and one
 * nested under the detail route (`-detail-edit`, or plain `-edit`). They are
 * the same page to the user, so they share one page key and one set of field
 * permissions; the permission editor shows a single "edit" entry.
 *
 * Keep the server mirror in `server/providers/page-field-visibility.ts` in
 * sync — enforcement has to resolve the same aliases.
 */
export function canonicalPageKey(pageKey: string): string {
  return pageKey
    .replace(/-list-edit(?=-|$)/u, '-edit')
    .replace(/-detail-edit(?=-|$)/u, '-edit')
    .replace(/-copy(?=-|$)/u, '-new');
}

/** The canonical key plus the legacy entry keys whose rows still apply. */
export function pageKeyVariants(pageKey: string): readonly string[] {
  const canonical = canonicalPageKey(pageKey);
  const aliases: string[] = [canonical];
  // Rows saved while "copy" had its own entry still apply to the create page.
  const copyAlias = canonical.replace(/-new(?=-|$)/u, '-copy');
  if (copyAlias !== canonical) aliases.push(copyAlias);
  if (!canonical.endsWith('-edit')) return aliases;
  const base = canonical.slice(0, -'-edit'.length);
  return [...aliases, `${base}-list-edit`, `${base}-detail-edit`];
}

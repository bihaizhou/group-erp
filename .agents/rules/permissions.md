# Permission management coverage

The permission workspace is generated from the application's route tree and field catalogue. These rules are invariants, not one-time migrations.

## Pages

- Every page route declares `authz` on the first page of its path. That declaration is the single source of truth for access permission.
- The page-permission tree and page-level field entry must never depend on a hand-maintained page allowlist. A new `authz` page automatically appears in the tree with its parent/child relationship; do not add page ids to a registry to make it visible.
- A page whose form reads `usePageFieldVisibility` exposes its field drawer from the route name and field resources. Do not gate that drawer behind a static `pageFieldVisibilityPageKeys` check.
- Overlay pages keep their localized title in `page-permission-titles.ts`; this is for display text only and must not gate visibility.

## Fields

- Field permissions derive from collection metadata. New collection columns must appear automatically, including columns without a `title`; only structural/internal columns may be listed in `exclude`.
- Page-level field lists must derive from the form model or the field catalogue. A JSON-backed form (`data` payload) is not a collection column, so its form model must export the field keys and titles; do not hand-copy individual field names into the role editor.
- Required fields stay visible. Fixed identity/action columns (document number, name link, row actions) must not be hideable.

## Tests

- `tests/client/page-field-coverage.test.ts` must prove that every collection field is either present in the catalogue or explicitly excluded.
- `tests/client/page-field-visibility-pages.test.ts` must cover every create route and every exposed page field list.
- `tests/client/permission-page-coverage.test.ts` must prove every business page has a navigation row.
- A change that adds a page or a field without updating these guarantees is incomplete.

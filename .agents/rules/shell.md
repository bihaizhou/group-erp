# Application shell

Read this before changing the layouts, header, sidebar, breadcrumbs, account menu or loading indicators under `client/layouts/`, `client/routing/` and `client/components/`.

## Breadcrumbs and layouts

Layouts own breadcrumb route context and render the current page's trail in the header after the sidebar toggle (`client/components/breadcrumbs.tsx`): the route trail by default, or the trail a page declares with `usePageBreadcrumb` from `@nocobase/app-client` when it names records. Pages do not render breadcrumbs themselves. `AppRouter` selects routes and layouts. See [pages and routes](../skills/nocobase-app-development/references/frontend/references/page.md) for each layout's scope.

## Header and sidebar

`client/layouts/components/layout-header.tsx` is a presentation container accepting children. The sidebar is shadcn's Sidebar: `components/app-sidebar.tsx` wraps its provider, desktop icon mode and phone sheet, and `components/navigation-menu.tsx` draws the permission-filtered route tree with `SidebarMenu*`: a top-level group with no page of its own is a section, its entries always shown under a `SidebarGroupLabel` heading, while clickable parents and nested groups are controlled `Collapsible` sub-menus, and an item `client/lib/navigation-transform.ts` marks `section` deeper in the tree is a heading over its direct links inside that menu; a count beside an entry, such as unread items, is passed by the App layout in `NavigationMenu`'s `badges`, keyed by route name. Leave `client/components/ui/sidebar.tsx` as the shadcn CLI writes it and customize from outside: widths go through the provider's `style` in spacing units, the phone sheet is rendered in `app-sidebar.tsx` with a translated title, and the provider's Ctrl/Cmd+B shortcut is stopped at `document`. The App layout owns menus, branding, permissions and redirects. Desktop icon mode hides top-level section headings and keeps their entries' icons, shows leaf labels as zero-delay tooltips and opens groups in hover and keyboard-focus popovers, preserving filtered navigation, parent-page links, nested groups and the selected group's highlight. Keep this behavior aligned across layouts. Desktop collapse state is shared through `useSidebarPreference` at `nocobase:sidebar:collapsed` across applications on the same origin; whether the phone sheet is open stays local to each layout.

The header carries no Settings or Inbox entry. An application has no separate settings area: a page that configures something is an ordinary route in `client/routes.ts` with `navigation`, placed in the sidebar like any other page, for example under a Settings navigation group. The `/inbox` page declares no navigation; give it an entry where the application wants one.

## Brand lockup

`client/layouts/components/app-brand.tsx` is the shell's lockup: the 秦望科技 mark (`public/assets/logo-qinwang.png`, or `logo-qinwang-dark.png` in dark mode) beside the name and a `QINWANG TECH` second line. The 20px name and 9px tagline are fixed brand geometry, not the page type scale; keep them in every density preset. The name uses `.brand-wordmark` in `client/styles.css`, which clips a gradient built from the `--brand-wordmark-*` tokens — define them in both the light and dark blocks of every theme preset in `client/theme/themes/`, keeping the dark set light enough for the dark sidebar. Compact desktop mode shows the mark alone; the phone header keeps the full lockup. The auth pages reuse the same mark and name in `client/pages/auth/shared.tsx`, so change both surfaces together; `logo.png`, `logo-mark.png` and their `-dark` variants stay because `index.html` points social metadata at them.

## Company scope

The URL remains the source of truth for the company a business page works in (`subjectId`). `client/layouts/components/company-scope-memory.tsx` remembers the last valid choice and fills it into the company-scoped routes listed in `client/lib/company-scope.ts` when the parameter is missing; it never overwrites an explicit empty value. Keep this behavior when changing the shell: pages read `subjectId` from the URL, and the memory only prevents asking for the same company on every module.

Company-scoped pages use `client/components/company-scope.tsx` (`CompanyScope`, `CompanyPicker`, `CompanyEmpty`) for the list, the choice, and the empty states; `client/hooks/use-only-company.ts` auto-selects when the module exposes exactly one company. The page passes its own authorised company endpoint (`queryPath`) and total, so the control never invents a global company list. Refresh, search, pagination, and the stale-memory check live in the shared control; do not add a page-local company picker or a second `chooseCompany` branch.

The header also carries `client/layouts/components/company-switcher.tsx`: it appears only on company-scoped paths, resolves the same module endpoint through `companyScopeEndpoint()` in `client/lib/company-scope.ts`, and writes the choice back to `subjectId` (plus `reviewSubjectId` when the settings editor uses it). It deliberately does not union companies across modules, so the header cannot offer a company the current page cannot read. This is the only header addition for company scope; pages must not duplicate a switcher. When upgrading the shell, keep the path-to-endpoint map and the two query parameters in sync with `COMPANY_SCOPED_PATHS`.

`client/lib/navigation-transform.ts` is the application-owned hook for customizing the permission-filtered navigation tree. The shared sidebar supports static section labels with direct links as well as collapsible groups.

Navigation groups retain their expanded or collapsed state while the navigation tree stays mounted. Selecting a new page expands its ancestor groups without collapsing other groups; users can still collapse the active group manually.

## Account menu and session

The account menu checks Better Auth sign-out results before refreshing the session and shows a localized error toast for API or network failures. Preserve this behavior when upgrading the shell; navigation alone does not revoke a session.

The authorization provider clears the permission snapshot before rendering a new session. Route navigation and page guards subscribe to the authorization revision; preserve these checks when customizing the shell so account changes and permission updates take effect without a reload. Pending checks hide protected content, and failed checks deny access.

The account menu language control in `client/layouts/components/language-switcher.tsx` uses a shadcn submenu with radio items. Render it inside `DropdownMenuContent` to preserve menu keyboard navigation and selection semantics.

## Branded loading

Use `Loading` for page or panel waits and `Spinner` (the shadcn-compatible adapter to `BrandSpinner`) for inline pending actions, uploads, and refresh indicators. Both share the stable NocoBase mark and orbit animation; do not introduce independent Lucide spinners for application loading. Keep skeletons for content placeholders and progress bars for determinate progress. `index.html` has the matching pre-JavaScript mark and must stay visually consistent. All animations respect reduced motion.

The shared list of shell behaviors to keep when customizing is in [customizing the shell](../skills/nocobase-app-development/references/frontend/references/shell.md).

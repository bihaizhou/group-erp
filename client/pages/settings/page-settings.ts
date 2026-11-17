import type { FieldPermissionResource } from '#components/field-permission-policies';
import type { PermissionEditorNavigationNode } from '#components/permission-editor';
import { fieldResourcesForPage } from './field-permission-pages.js';
import { pageFieldVisibilityInheritedFrom } from './page-field-visibility-fallback.js';
import {
  pageFieldVisibilityBaseKey,
  pageFieldVisibilityExtraFields,
  pageFieldVisibilityFields,
} from './page-field-visibility-pages.js';

/** Localized labels for the page tabs of the unified permission drawer. */
export interface PageTabLabels {
  readonly list: string;
  readonly page: string;
  readonly new: string;
  readonly edit: string;
  readonly detail: string;
}

export interface PageDisplayTarget {
  readonly pageKey: string;
  readonly fallbackPageKey?: string | undefined;
  readonly resourceId: string;
  readonly label: string;
  readonly path?: string | undefined;
  readonly resources: readonly string[];
  readonly tabLabel: string;
  readonly kind: 'parent' | 'child';
  /** A deeper route kept out of the tab strip and offered under More pages. */
  readonly advanced: boolean;
}

function suffixTabLabel(pageKey: string, labels: PageTabLabels): string {
  if (pageKey.endsWith('-detail-edit')) {
    return `${labels.detail} · ${labels.edit}`;
  }
  if (pageKey.endsWith('-list-edit')) {
    return `${labels.list} · ${labels.edit}`;
  }
  if (pageKey.endsWith('-new')) return labels.new;
  if (pageKey.endsWith('-detail')) return labels.detail;
  if (pageKey.endsWith('-edit')) return labels.edit;
  return '';
}

function childTabLabel(
  node: PermissionEditorNavigationNode,
  parentLabel: string,
  labels: PageTabLabels,
): string {
  const pageKey = node.pageKey ?? '';
  const prefix = `${parentLabel} · `;
  const rest = node.label.startsWith(prefix)
    ? node.label.slice(prefix.length)
    : node.label;
  const parts = rest.split(' · ');
  const short = suffixTabLabel(pageKey, labels);
  // Nested pages (收货 · 新建, 物料 · 编辑…) keep their group so several
  // "新建" entries under one page stay distinguishable.
  if (parts.length > 2 && short && !short.includes(' · ')) {
    return `${parts[parts.length - 2]} · ${short}`;
  }
  if (short) return short;
  return rest.replaceAll(' · ', ' / ');
}

/** Suffix below the page's own key, e.g. purchase-requests → -new. */
function isPrimaryPageSuffix(
  parentPageKey: string | undefined,
  pageKey: string,
): boolean {
  const relative =
    parentPageKey && pageKey.startsWith(`${parentPageKey}-`)
      ? pageKey.slice(parentPageKey.length)
      : pageKey;
  return /^-(detail-edit|list-edit|new|edit|detail)$/.test(relative);
}

function targetFor(
  node: PermissionEditorNavigationNode,
  parentLabel: string,
  parentPageKey: string | undefined,
  labels: PageTabLabels,
  kind: PageDisplayTarget['kind'],
): PageDisplayTarget | undefined {
  if (!node.pageKey) return undefined;
  // Prefer the page-resource map so field keys line up with legacy
  // resource-level field policies (e.g. people.employee.grade); page data
  // resources (people.profile) are only used when the map has no entry.
  const mapped =
    node.resourceId && node.resourceId.length > 0
      ? fieldResourcesForPage(node.resourceId)
      : [];
  const resources =
    mapped.length > 0
      ? mapped
      : node.dataResources && node.dataResources.length > 0
        ? node.dataResources
        : [];
  return {
    pageKey: node.pageKey,
    fallbackPageKey: pageFieldVisibilityInheritedFrom(node.pageKey),
    resourceId: node.resourceId ?? node.pageKey,
    label: node.label,
    path: node.path,
    resources,
    tabLabel:
      kind === 'parent'
        ? labels.page
        : childTabLabel(node, parentLabel, labels),
    kind,
    advanced:
      kind === 'child' && !isPrimaryPageSuffix(parentPageKey, node.pageKey ?? ''),
  };
}

/**
 * The parent page plus every inherited route below it. The common
 * list/new/edit/detail routes become tabs; deeper routes are marked advanced
 * and are offered under More pages in the same drawer.
 */
export function collectPageDisplays(
  node: PermissionEditorNavigationNode,
  labels: PageTabLabels,
): readonly PageDisplayTarget[] {
  const targets: PageDisplayTarget[] = [];
  const seen = new Set<string>();
  const visit = (
    current: PermissionEditorNavigationNode,
    parentLabel: string,
    parentPageKey: string | undefined,
  ): void => {
    if (current.pageKey) {
      const target = targetFor(
        current,
        parentLabel,
        parentPageKey,
        labels,
        current.hint ? 'child' : 'parent',
      );
      if (target && !seen.has(target.pageKey)) {
        seen.add(target.pageKey);
        targets.push(target);
      }
    }
    const nextPageKey = current.hint
      ? parentPageKey
      : (current.pageKey ?? parentPageKey);
    // Labels below a page are prefixed with the page name; group nodes in
    // between (订单, 申请…) must not become the prefix.
    const nextLabel =
      !current.hint && current.pageKey ? current.label : parentLabel;
    for (const child of current.children ?? []) {
      visit(child, nextLabel, nextPageKey);
    }
  };
  visit(node, node.label, undefined);
  const pageKeys = new Set(targets.map((target) => target.pageKey));
  return targets.map((target) => {
    if (
      target.kind === 'parent' &&
      [...pageKeys].some(
        (key) => key !== target.pageKey && key.startsWith(`${target.pageKey}-`),
      )
    ) {
      return { ...target, tabLabel: labels.list };
    }
    return target;
  });
}

/** Fields shown by the per-page visibility editor, in catalogue order. */
export function pageFieldResourcesForTarget(
  target: PageDisplayTarget,
  catalog: readonly FieldPermissionResource[],
): readonly FieldPermissionResource[] {
  const configKey =
    pageFieldVisibilityBaseKey(target.pageKey) ?? target.pageKey;
  const declared = pageFieldVisibilityFields[configKey];
  const auto = !declared?.length;
  const allowed = new Set(declared ?? []);
  const extras = pageFieldVisibilityExtraFields[configKey] ?? [];
  const result = target.resources.flatMap((resourceId) => {
    const base = catalog.find((item) => item.resource === resourceId);
    const fields = [
      ...(base?.fields ?? []).filter(
        (field) => auto || allowed.has(`${resourceId}.${field.field}`),
      ),
      ...extras
        .filter((extra) => extra.resource === resourceId)
        .map((extra) => ({
          field: extra.field,
          titleKey: extra.titleKey,
          label: extra.titleKey,
        })),
    ].filter(
      (field, index, all) =>
        all.findIndex((candidate) => candidate.field === field.field) === index,
    );
    return fields.length === 0
      ? []
      : [
          {
            resource: resourceId,
            titleKey: base?.titleKey ?? resourceId,
            descriptionKey: base?.descriptionKey ?? '',
            fields,
          },
        ];
  });
  return result;
}

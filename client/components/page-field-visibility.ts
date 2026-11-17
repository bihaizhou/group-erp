import { useEffect, useState } from 'react';
import { useApiClient } from '@nocobase/app-client';
import { pageFieldVisibilityInheritedFrom } from '../pages/settings/page-field-visibility-fallback.js';

interface EffectiveVisibility {
  configured: boolean;
  visible: string[];
  writable: string[];
  fields?: {
    resource: string;
    field: string;
    visible: boolean;
    writable: boolean;
  }[];
}

interface PageState {
  pageKey: string;
  visibility?: EffectiveVisibility;
  failed?: boolean;
}

/**
 * Per-page field permissions. `visible` answers "does this page render the
 * field?" and `writable` answers "may the user change it on this page?".
 * Both are enforced server-side; the hook only mirrors the policy in the UI.
 */
export interface PageFieldVisibility {
  readonly loading: boolean;
  readonly configured: boolean;
  readonly visible: (resource: string, field: string) => boolean;
  readonly writable: (resource: string, field: string) => boolean;
}

const keyOf = (resource: string, field: string): string =>
  `${resource}.${field}`;

export function usePageFieldVisibility(
  pageKey: string,
  fallbackPageKey = pageFieldVisibilityInheritedFrom(pageKey),
): PageFieldVisibility {
  const api = useApiClient();
  const [state, setState] = useState<PageState>();

  useEffect(() => {
    if (!pageKey) return;
    const controller = new AbortController();
    void api
      .request<{ data: EffectiveVisibility }>({
        path: 'page-field-visibility/effective',
        query: {
          pageKey,
          ...(fallbackPageKey ? { fallbackPageKey } : {}),
        },
        signal: controller.signal,
      })
      .then((response) => {
        if (controller.signal.aborted) return;
        setState({ pageKey, visibility: response.data });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // A failed lookup must not blank out a working form.
        setState({ pageKey, failed: true });
      });
    return () => controller.abort();
  }, [api, pageKey, fallbackPageKey]);

  const current = state?.pageKey === pageKey ? state : undefined;
  const configured = current?.visibility?.configured === true;
  const rows = new Map(
    (current?.visibility?.fields ?? []).map((row) => [
      keyOf(row.resource, row.field),
      row,
    ]),
  );
  return {
    loading: pageKey ? !current : false,
    configured,
    visible: (resource, field) =>
      !configured || (rows.get(keyOf(resource, field))?.visible ?? true),
    writable: (resource, field) =>
      !configured || (rows.get(keyOf(resource, field))?.writable ?? true),
  };
}

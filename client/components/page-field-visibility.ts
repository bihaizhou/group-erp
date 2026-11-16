import { useEffect, useState } from 'react';
import { useApiClient } from '@nocobase/app-client';

interface EffectiveVisibility {
  configured: boolean;
  visible: string[];
}

interface PageState {
  pageKey: string;
  visibility?: EffectiveVisibility;
  failed?: boolean;
}

/**
 * Page-level field visibility is display-only. It answers "does this page
 * render the field?" and must not be used to decide whether data is readable.
 */
export interface PageFieldVisibility {
  readonly loading: boolean;
  readonly configured: boolean;
  readonly visible: (resource: string, field: string) => boolean;
}

const keyOf = (resource: string, field: string): string =>
  `${resource}.${field}`;

export function usePageFieldVisibility(pageKey: string): PageFieldVisibility {
  const api = useApiClient();
  const [state, setState] = useState<PageState>();

  useEffect(() => {
    const controller = new AbortController();
    void api
      .request<{ data: EffectiveVisibility }>({
        path: 'page-field-visibility/effective',
        query: { pageKey },
        signal: controller.signal,
      })
      .then((response) => {
        if (controller.signal.aborted) return;
        setState({ pageKey, visibility: response.data });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // A failed presentation lookup must not blank out a working form.
        setState({ pageKey, failed: true });
      });
    return () => controller.abort();
  }, [api, pageKey]);

  const current = state?.pageKey === pageKey ? state : undefined;
  const configured = current?.visibility?.configured === true;
  const visible = new Set(current?.visibility?.visible ?? []);
  return {
    loading: !current,
    configured,
    visible: (resource, field) =>
      !configured || visible.has(keyOf(resource, field)),
  };
}

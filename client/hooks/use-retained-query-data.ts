import { useState } from 'react';
import { ApiClientError } from '@nocobase/app-client';

/** Keep the last successful result during a retryable search failure, scoped to
 * the same company and reference kind. Access failures always discard it. */
export function useRetainedQueryData<T>(
  identity: string,
  result: { data: T | undefined; error: unknown; isPlaceholderData: boolean },
  enabled = true,
) {
  const [last, setLast] = useState<{ identity: string; data: T }>();
  // React's guarded state adjustment records the successful response before
  // rendering children; the identity/data comparison converges in one render.
  if (
    enabled &&
    result.data !== undefined &&
    !result.isPlaceholderData &&
    (last?.identity !== identity || last.data !== result.data)
  )
    setLast({ identity, data: result.data });
  const terminal =
    result.error instanceof ApiClientError &&
    [401, 403, 404].includes(result.error.status);
  const fallback =
    enabled &&
    !terminal &&
    !!result.error &&
    result.data === undefined &&
    last?.identity === identity;
  return {
    data: terminal && enabled ? undefined : fallback ? last.data : result.data,
    isStaleFallback: fallback,
  };
}

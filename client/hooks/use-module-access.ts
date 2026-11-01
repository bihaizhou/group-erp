import {
  useAuthorizationClient,
  useAuthorizationRevision,
} from '@nocobase/app-plugin-authorization/client';
import { useEffect, useState } from 'react';
import type { AccessCheck } from '../modules/catalog.js';

export const accessKey = (check: AccessCheck) =>
  `${check.type}:${check.id}:${check.action}`;

/**
 * Resolves many page/settings checks in one effect. The permission snapshot is
 * already cached by the authorization client, so this does not duplicate the
 * per-card requests the old pages issued.
 */
export function useModuleAccess(checks: readonly AccessCheck[]) {
  const client = useAuthorizationClient(),
    revision = useAuthorizationRevision(),
    [allowed, setAllowed] = useState<ReadonlySet<string>>(() => new Set()),
    [isPending, setIsPending] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const unique = new Map(checks.map((check) => [accessKey(check), check])),
        results = await Promise.all(
          [...unique].map(async ([key, check]) => {
            try {
              return (await client.can({
                resource: { type: check.type, id: check.id },
                action: check.action,
              }))
                ? key
                : undefined;
            } catch {
              // A failed check is treated as denied, not as a crash.
              return undefined;
            }
          }),
        ),
        next = new Set(results.filter((key): key is string => !!key));
      if (!cancelled) {
        setAllowed(next);
        setIsPending(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, revision, checks]);
  return { allowed, isPending };
}

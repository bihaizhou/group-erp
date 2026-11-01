import { z } from 'zod';
import { supplyChainFail } from './supply-chain-model.js';

// The persistent A2 source bridge uses this identity contract; a header revision alone must not invalidate an unchanged line.
const version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const materialSourceIdentity = z.strictObject({
  sourceKind: z.enum(['purchaseRequestLine', 'materialIssueRequestLine']),
  sourceDocumentId: z.string().uuid(),
  sourceLineId: z.string().uuid(),
  subjectId: z.string().uuid(),
  inputRevision: version,
  governanceEpoch: version,
  governanceAttempt: version,
});
export type MaterialSourceIdentity = z.infer<typeof materialSourceIdentity>;
export interface CurrentMaterialSource {
  identity: MaterialSourceIdentity;
  documentStatus: 'draft' | 'pending' | 'approved' | 'cancelled';
  lineStatus: 'active' | 'cancelled';
  activeSourceLinkId: string | null;
  linkId: string;
  linkStatus:
    'pending' | 'needsInformation' | 'offered' | 'applied' | 'invalidated';
  canConfirm: boolean;
}

// Guards delivery to a pending source. Accepting an already offered result is
// a separate business action with its own status and version checks.
export function assertCurrentMaterialSource(
  expected: MaterialSourceIdentity,
  current: CurrentMaterialSource,
): void {
  materialSourceIdentity.parse(expected);
  materialSourceIdentity.parse(current.identity);
  if (!current.canConfirm) return supplyChainFail('SUPPLY_FORBIDDEN');
  if (
    current.documentStatus === 'cancelled' ||
    current.lineStatus !== 'active' ||
    current.linkStatus !== 'pending' ||
    current.activeSourceLinkId !== current.linkId ||
    Object.keys(expected).some(
      (key) =>
        expected[key as keyof MaterialSourceIdentity] !==
        current.identity[key as keyof MaterialSourceIdentity],
    )
  )
    return supplyChainFail('SUPPLY_SOURCE_STALE');
}
